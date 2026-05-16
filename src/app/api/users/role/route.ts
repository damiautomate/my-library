import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RoleBody {
  /** UID of the user being modified. */
  uid?: string;
  /** New role (omit to leave unchanged). */
  role?: "admin" | "member";
  /** Set to true to suspend the user, false to re-enable. */
  disabled?: boolean;
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
    console.error("[users/role] verifyIdToken FAILED", msg);
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

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: RoleBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.uid) {
    return NextResponse.json({ error: "Missing uid" }, { status: 400 });
  }
  if (body.role === undefined && body.disabled === undefined) {
    return NextResponse.json(
      { error: "Provide role and/or disabled" },
      { status: 400 },
    );
  }

  const targetRef = adminDb.collection("users").doc(body.uid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const target = targetSnap.data() as { role?: "admin" | "member"; disabled?: boolean };

  // Safety: prevent removing the last admin.
  const removingLastAdminPrivilege =
    (body.role === "member" || body.disabled === true) &&
    target.role === "admin";
  if (removingLastAdminPrivilege) {
    const adminsSnap = await adminDb
      .collection("users")
      .where("role", "==", "admin")
      .get();
    const activeAdmins = adminsSnap.docs.filter(
      (d) => d.data().disabled !== true,
    );
    if (activeAdmins.length <= 1) {
      return NextResponse.json(
        {
          error:
            "Cannot demote or disable the only remaining active admin. Promote another member to admin first.",
        },
        { status: 409 },
      );
    }
  }

  const patch: Record<string, unknown> = {
    last_active_at: FieldValue.serverTimestamp(),
  };
  if (body.role !== undefined) patch.role = body.role;
  if (body.disabled !== undefined) patch.disabled = body.disabled;
  await targetRef.update(patch);

  // If disabling, also revoke the user's refresh tokens so they're signed out
  // of any other active sessions within an hour. ID tokens last up to 1 hour
  // but the client will pick up the disabled flag in real time via Firestore.
  if (body.disabled === true) {
    try {
      await adminAuth.revokeRefreshTokens(body.uid);
    } catch (err) {
      console.warn("[users/role] revokeRefreshTokens failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}
