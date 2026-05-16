import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DeleteBody {
  public_id: string;
  resource_type?: "image" | "raw" | "video";
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
  } catch {
    return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
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

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "Cloudinary credentials missing" },
      { status: 500 },
    );
  }

  let body: DeleteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.public_id) {
    return NextResponse.json({ error: "Missing public_id" }, { status: 400 });
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });

  try {
    const result = await cloudinary.uploader.destroy(body.public_id, {
      resource_type: body.resource_type ?? "image",
      invalidate: true,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
