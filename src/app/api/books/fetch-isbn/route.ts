import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { cleanIsbn, isValidIsbn, lookupIsbn } from "@/lib/isbn-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FetchBody {
  isbn?: string;
}

async function requireAdmin(
  req: NextRequest,
): Promise<{ uid: string } | NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (!idToken)
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fetch-isbn] verifyIdToken FAILED", msg);
    return NextResponse.json(
      { error: `Invalid auth token: ${msg}` },
      { status: 401 },
    );
  }
  const u = await adminDb.collection("users").doc(decoded.uid).get();
  if (!u.exists || u.data()?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return { uid: decoded.uid };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: FetchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isbn = cleanIsbn(body.isbn ?? "");
  if (!isValidIsbn(isbn)) {
    return NextResponse.json(
      { error: "Provide a valid ISBN-10 or ISBN-13." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  console.info(`[fetch-isbn] Looking up ${isbn} (apiKey: ${!!apiKey})`);

  const result = await lookupIsbn(isbn);
  if (result) return NextResponse.json(result);

  console.info(`[fetch-isbn] All sources missed for ${isbn}`);
  return NextResponse.json(
    {
      error: apiKey
        ? `No book found for ISBN ${isbn} in any source. Try entering details manually.`
        : `No book found for ISBN ${isbn}. (Tip: ask the librarian to set GOOGLE_BOOKS_API_KEY in Vercel to avoid the shared anonymous quota.)`,
    },
    { status: 404 },
  );
}
