import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Share-link management for a single book (Phase 9t). Admin-only.
 *
 *   POST   /api/books/{bookId}/share   → generate (or regenerate) + enable
 *   DELETE /api/books/{bookId}/share   → disable (keeps token, just gates off)
 *
 * The token is the sole credential the PUBLIC routes accept:
 *   - GET /api/share/{token}            (book data)
 *   - GET /api/file/{bookId}/{kind}?share={token}  (file bytes)
 *
 * Regenerating invalidates every link sent so far. Disabling pauses access
 * without discarding the token (re-enable returns the same link).
 */

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
    return NextResponse.json(
      { error: `Invalid auth token: ${msg}` },
      { status: 401 },
    );
  }
  const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return { uid: decoded.uid };
}

/** 24-char URL-safe token. 18 random bytes → 24 base64url chars, ~10^43
 * keyspace — not brute-forceable. */
function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { bookId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const bookRef = adminDb.collection("books").doc(params.bookId);
  const snap = await bookRef.get();
  if (!snap.exists)
    return NextResponse.json({ error: "Book not found" }, { status: 404 });

  // Body may request keeping the existing token (just re-enable) vs rotating.
  let regenerate = false;
  try {
    const body = await req.json();
    regenerate = body?.regenerate === true;
  } catch {
    // no body — default to: create token if missing, else keep & enable
  }

  const existing = snap.data()?.share_token as string | undefined;
  const token = regenerate || !existing ? newToken() : existing;

  await bookRef.update({
    share_enabled: true,
    share_token: token,
    share_created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, token, enabled: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { bookId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const bookRef = adminDb.collection("books").doc(params.bookId);
  const snap = await bookRef.get();
  if (!snap.exists)
    return NextResponse.json({ error: "Book not found" }, { status: 404 });

  // Disable without clearing the token so re-enabling restores the same link.
  await bookRef.update({
    share_enabled: false,
    updated_at: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, enabled: false });
}
