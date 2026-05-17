import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Books can be large; allow up to 5 minutes for the stream
export const maxDuration = 300;

/**
 * GET /api/file/{bookId}/{kind}
 *
 * Streams a book file (pdf|epub|audio) from Cloudinary through our server.
 *
 * Why proxy instead of using the Cloudinary URL directly?
 *
 *   1. Same-origin — no CORS edge cases when pdf.js / epub.js fetch the bytes
 *   2. Correct Content-Type — Cloudinary serves raw resources as
 *      application/octet-stream; some readers prefer application/pdf etc.
 *   3. Auth — the file URL no longer leaks. Only signed-in library members
 *      can hit this route, so file access is gated by Firestore rules.
 *   4. Download support — pass ?dl=1 to force Content-Disposition: attachment
 *
 * Query params:
 *   ?dl=1          Force-download (Content-Disposition: attachment)
 */

type Kind = "pdf" | "epub" | "audio";

const CONTENT_TYPES: Record<Kind, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  audio: "audio/mpeg",
};

const URL_FIELDS: Record<Kind, string> = {
  pdf: "pdf_url",
  epub: "epub_url",
  audio: "audio_summary_url",
};

async function requireSignedIn(
  req: NextRequest,
): Promise<{ uid: string; isAdmin: boolean } | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  let idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  // Also accept token from query string (since pdf.js / audio elements can't
  // easily set Authorization headers when loading by URL).
  if (!idToken) idToken = req.nextUrl.searchParams.get("t");
  if (!idToken)
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[file-proxy] verifyIdToken FAILED", msg);
    return NextResponse.json(
      { error: `Invalid auth token: ${msg}` },
      { status: 401 },
    );
  }
  const u = await adminDb.collection("users").doc(decoded.uid).get();
  if (!u.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 403 });
  }
  if (u.data()?.disabled) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }
  const isAdmin = u.data()?.role === "admin";
  return { uid: decoded.uid, isAdmin };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { bookId: string; kind: string } },
) {
  const auth = await requireSignedIn(req);
  if (auth instanceof NextResponse) return auth;

  const kind = params.kind as Kind;
  if (!["pdf", "epub", "audio"].includes(kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const bookRef = adminDb.collection("books").doc(params.bookId);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  const book = bookSnap.data() as Record<string, unknown>;

  // Visibility — members see only published; admins see everything
  if (book.status !== "published" && !auth.isAdmin) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const fileUrl = book[URL_FIELDS[kind]] as string | undefined;
  if (!fileUrl) {
    return NextResponse.json(
      { error: `No ${kind} file for this book` },
      { status: 404 },
    );
  }

  // Stream the upstream response. Forward Range headers so byte-range
  // requests (audio scrubbing, large PDF viewing) work.
  const range = req.headers.get("range");
  const upstreamHeaders: Record<string, string> = {};
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(fileUrl, {
    headers: upstreamHeaders,
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: `Upstream returned ${upstream.status}` },
      { status: 502 },
    );
  }

  // Build response headers
  const headers = new Headers();
  headers.set("Content-Type", CONTENT_TYPES[kind]);
  headers.set("Cache-Control", "private, max-age=3600");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  const wantsDownload = req.nextUrl.searchParams.get("dl") === "1";
  if (wantsDownload) {
    const title = (book.title as string) || "book";
    const ext = kind === "audio" ? "mp3" : kind;
    const filename = `${title.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60)}.${ext}`;
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
