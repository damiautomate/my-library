import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

// This route reads request headers (Authorization) and Firestore admin data,
// so it must run dynamically — never statically rendered at build time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Require a valid admin user. Returns the UID, or a NextResponse on failure. */
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
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }
  const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return { uid: decoded.uid };
}

// GET — list all invitations (admin only)
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const snap = await adminDb
    .collection("invitations")
    .orderBy("created_at", "desc")
    .get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return NextResponse.json({ items });
}

// POST — create a new invitation
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: { email?: string; role?: "admin" | "member" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const role: "admin" | "member" = body.role === "admin" ? "admin" : "member";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Prevent duplicate pending invitations for the same email.
  const existing = await adminDb
    .collection("invitations")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!existing.empty) {
    return NextResponse.json(
      { error: "A pending invitation for this email already exists." },
      { status: 409 },
    );
  }

  const ref = await adminDb.collection("invitations").add({
    email,
    invited_by: auth.uid,
    role,
    status: "pending",
    created_at: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ id: ref.id, email, role, status: "pending" });
}

// DELETE — revoke an invitation by ID (passed as ?id=)
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await adminDb.collection("invitations").doc(id).update({ status: "revoked" });
  return NextResponse.json({ ok: true });
}
