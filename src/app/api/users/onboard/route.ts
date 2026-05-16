import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

// This route reads request headers and uses the Admin SDK at request time —
// never statically render.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/users/onboard
 *
 * Called after a successful Firebase Auth signup/signin. Validates the email
 * against the `invitations` allowlist. If accepted, creates users/{uid} and
 * marks the invitation accepted. If rejected, deletes the orphan auth user.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!idToken) {
    console.warn("[onboard] No Bearer token in Authorization header");
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    // Log the real reason so Vercel's function logs show what's wrong.
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code ?? "no-code";
    console.error("[onboard] verifyIdToken FAILED", {
      code,
      message: msg,
      adminProjectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmailSuffix:
        process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.split("@")[1] ?? "missing",
      privateKeyPresent: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
      privateKeyStartsWithBegin:
        process.env.FIREBASE_ADMIN_PRIVATE_KEY?.includes("BEGIN PRIVATE KEY") ??
        false,
    });
    return NextResponse.json(
      { error: `Invalid auth token: ${msg}` },
      { status: 401 },
    );
  }

  const uid = decoded.uid;
  const email = (decoded.email ?? "").toLowerCase();
  if (!email) {
    console.warn("[onboard] No email on decoded token", { uid });
    return NextResponse.json({ error: "No email on token" }, { status: 400 });
  }

  // Returning user — just touch last_active_at
  const userRef = adminDb.collection("users").doc(uid);
  const existing = await userRef.get();
  if (existing.exists) {
    await userRef.update({ last_active_at: FieldValue.serverTimestamp() });
    const role = (existing.data()?.role as "admin" | "member") ?? "member";
    return NextResponse.json({ role });
  }

  // Look up a pending invitation for this email
  const inviteSnap = await adminDb
    .collection("invitations")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (inviteSnap.empty) {
    console.info("[onboard] No pending invitation; deleting orphan auth user", {
      email,
      uid,
    });
    try {
      await adminAuth.deleteUser(uid);
    } catch (e) {
      console.warn("[onboard] deleteUser cleanup failed (non-fatal)", e);
    }
    return NextResponse.json(
      {
        error:
          "No invitation found for this email. Please ask the librarian for an invite.",
      },
      { status: 403 },
    );
  }

  const invite = inviteSnap.docs[0];
  const inviteData = invite.data() as {
    invited_by: string;
    role: "admin" | "member";
  };

  await userRef.set({
    uid,
    email,
    display_name:
      decoded.name ??
      (typeof decoded.firebase?.identities?.email?.[0] === "string"
        ? (decoded.firebase.identities.email[0] as string).split("@")[0]
        : email.split("@")[0]),
    photo_url: decoded.picture ?? null,
    role: inviteData.role,
    invited_by: inviteData.invited_by,
    joined_at: FieldValue.serverTimestamp(),
    last_active_at: FieldValue.serverTimestamp(),
  });

  await invite.ref.update({
    status: "accepted",
    accepted_at: FieldValue.serverTimestamp(),
  });

  console.info("[onboard] Accepted invitation", { email, role: inviteData.role });
  return NextResponse.json({ role: inviteData.role });
}
