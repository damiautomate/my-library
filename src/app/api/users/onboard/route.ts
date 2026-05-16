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
 * Called by the client immediately after a successful Firebase Auth signup
 * (email/password OR Google). Validates the user's email against the
 * `invitations` allowlist:
 *
 *   - if a matching `pending` invitation exists:
 *       * creates users/{uid} with the invited role
 *       * marks the invitation `accepted`
 *       * returns 200 { role }
 *
 *   - if no invitation exists:
 *       * deletes the just-created auth user
 *       * returns 403
 *
 * Auth: requires a Bearer ID token from the just-signed-up user.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (!idToken) {
    return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
  }
  const uid = decoded.uid;
  const email = (decoded.email ?? "").toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "No email on token" }, { status: 400 });
  }

  // If the user already has a users doc, this is a returning user. Just touch
  // last_active_at and return their role.
  const userRef = adminDb.collection("users").doc(uid);
  const existing = await userRef.get();
  if (existing.exists) {
    await userRef.update({ last_active_at: FieldValue.serverTimestamp() });
    const role = (existing.data()?.role as "admin" | "member") ?? "member";
    return NextResponse.json({ role });
  }

  // Look up a pending invitation for this email.
  const inviteSnap = await adminDb
    .collection("invitations")
    .where("email", "==", email)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (inviteSnap.empty) {
    // No invitation — revoke this auth account and reject.
    try {
      await adminAuth.deleteUser(uid);
    } catch {
      // best-effort cleanup; ignore failures
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

  // Create users doc
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

  // Mark invitation accepted
  await invite.ref.update({
    status: "accepted",
    accepted_at: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ role: inviteData.role });
}
