import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  DEFAULT_AI_SETTINGS,
  configuredProviders,
  getAiSettings,
} from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/admin/ai-settings — current provider + models, and which keys exist
 * PUT  /api/admin/ai-settings — save provider + model overrides
 *
 * Admin only. The settings doc is read and written exclusively through the
 * Admin SDK, so no Firestore rule grants clients access to it.
 *
 * API keys are never stored here or returned by this route — only booleans
 * saying whether each provider's environment variable is present.
 */

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

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const settings = await getAiSettings();
  return NextResponse.json({
    settings,
    defaults: DEFAULT_AI_SETTINGS,
    configured: configuredProviders(),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    anthropic_smart_model?: string;
    anthropic_fast_model?: string;
    openai_smart_model?: string;
    openai_fast_model?: string;
  };

  if (body.provider !== "anthropic" && body.provider !== "openai") {
    return NextResponse.json(
      { error: "provider must be 'anthropic' or 'openai'" },
      { status: 400 },
    );
  }

  // Refuse to select a provider whose key is missing — otherwise the failure
  // surfaces later as a confusing 500 in the middle of an import.
  const configured = configuredProviders();
  if (!configured[body.provider]) {
    const envName =
      body.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    return NextResponse.json(
      {
        error: `Can't switch to ${body.provider}: ${envName} is not set. Add it to your Vercel environment variables and redeploy first.`,
      },
      { status: 409 },
    );
  }

  const clean = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : fallback;

  await adminDb.doc("settings/ai").set(
    {
      provider: body.provider,
      anthropic_smart_model: clean(
        body.anthropic_smart_model,
        DEFAULT_AI_SETTINGS.anthropicSmartModel,
      ),
      anthropic_fast_model: clean(
        body.anthropic_fast_model,
        DEFAULT_AI_SETTINGS.anthropicFastModel,
      ),
      openai_smart_model: clean(
        body.openai_smart_model,
        DEFAULT_AI_SETTINGS.openaiSmartModel,
      ),
      openai_fast_model: clean(
        body.openai_fast_model,
        DEFAULT_AI_SETTINGS.openaiFastModel,
      ),
      updated_at: new Date().toISOString(),
      updated_by: auth.uid,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, settings: await getAiSettings() });
}
