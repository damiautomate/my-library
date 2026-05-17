import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface BulkUpdateBody {
  book_ids?: string[];
  status?: "published" | "draft" | "archived";
}

async function requireAdmin(req: NextRequest) {
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
  const u = await adminDb.collection("users").doc(decoded.uid).get();
  if (!u.exists || u.data()?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return { uid: decoded.uid };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: BulkUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.book_ids) || body.book_ids.length === 0) {
    return NextResponse.json({ error: "book_ids must be a non-empty array" }, { status: 400 });
  }
  if (!body.status) {
    return NextResponse.json({ error: "status required" }, { status: 400 });
  }
  if (body.book_ids.length > 500) {
    return NextResponse.json(
      { error: "Max 500 books per call" },
      { status: 400 },
    );
  }

  // Firestore allows max 500 ops per WriteBatch; we're capped at 500 already.
  const batch = adminDb.batch();
  for (const id of body.book_ids) {
    if (typeof id !== "string" || !id) continue;
    batch.update(adminDb.collection("books").doc(id), {
      status: body.status,
      updated_at: FieldValue.serverTimestamp(),
      ...(body.status === "published" ? { published_at: FieldValue.serverTimestamp() } : {}),
    });
  }
  await batch.commit();

  return NextResponse.json({ ok: true, updated: body.book_ids.length });
}
