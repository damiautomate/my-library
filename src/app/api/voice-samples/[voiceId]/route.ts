import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { adminDb } from "@/lib/firebase/admin";
import { getProvider } from "@/lib/tts";
import { getVoiceById, VOICE_CATALOG } from "@/lib/voices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/voice-samples/[voiceId] — narrator preview audio (Phase 9q).
 *
 * Returns a short MP3 sample of the given voice reading a fixed passage so
 * the picker UI can play "▶ Preview" without committing to regenerating an
 * entire book.
 *
 * On first request for a given voice: synthesizes, uploads to Cloudinary,
 * stores the URL in Firestore (so we don't re-synthesize across cold starts),
 * then 302-redirects to the Cloudinary URL.
 *
 * On subsequent requests: looks up the cached URL and redirects immediately.
 *
 * Sample passage was chosen for prosody variety in ~25 seconds of audio:
 * two sentences with different rhythms, common punctuation, and one
 * direct address. Same passage across all voices makes A/B comparison easy.
 *
 * Auth: none — these are short samples and the endpoint is rate-limit-safe
 * (one synthesis per voice, ever, then static CDN). If we ever feel the need
 * to lock it down, gate by signed-in user.
 */

const SAMPLE_TEXT =
  "Let me read you a passage. As she sat by the window, watching the rain fall against the glass, she realized how much had changed since that quiet morning a year ago.";

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ voiceId: string }> },
) {
  const { voiceId } = await ctx.params;
  if (!voiceId)
    return NextResponse.json({ error: "Missing voiceId" }, { status: 400 });

  // Reject requests for voices we don't recognize — otherwise an attacker
  // could DOS our Google TTS quota by requesting infinite random voice names.
  const voice = VOICE_CATALOG.find((v) => v.id === voiceId);
  if (!voice) {
    return NextResponse.json({ error: "Unknown voice" }, { status: 404 });
  }

  // Cached sample URLs live in a single Firestore doc keyed by voice ID, so
  // they survive serverless cold starts without re-synthesis.
  const cacheRef = adminDb.collection("voice_samples").doc(voiceId);
  const cached = await cacheRef.get();
  if (cached.exists && cached.data()?.url) {
    return NextResponse.redirect(cached.data()!.url as string, 302);
  }

  // First-ever request for this voice — synthesize and cache.
  const provider = getProvider("google");
  let result;
  try {
    if (voice.tier === "chirp3-hd") {
      // Chirp 3 HD: plain text only, no SSML.
      result = await provider.synthesize({
        text: SAMPLE_TEXT,
        voiceId: voice.id,
        languageCode: voice.languageCode,
        requestTimepoints: false,
      });
    } else if (voice.mode === "premium") {
      // Studio: SSML allowed but no marks.
      result = await provider.synthesize({
        ssml: `<speak>${SAMPLE_TEXT}</speak>`,
        voiceId: voice.id,
        languageCode: voice.languageCode,
        requestTimepoints: false,
      });
    } else {
      // Synced (Neural2/News): plain text is fine for the preview — we don't
      // need marks since we're not playing alongside a PDF.
      result = await provider.synthesize({
        text: SAMPLE_TEXT,
        voiceId: voice.id,
        languageCode: voice.languageCode,
        requestTimepoints: false,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Sample synthesis failed: ${msg}` },
      { status: 502 },
    );
  }

  configureCloudinary();
  let uploadedUrl: string;
  try {
    const uploaded = await new Promise<{ secure_url: string }>(
      (resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: "my-library/voice-samples",
              public_id: voice.id,
              resource_type: "video", // Cloudinary uses "video" for audio uploads
              format: "mp3",
              overwrite: true,
            },
            (err, r) => {
              if (err || !r)
                reject(err ?? new Error("Cloudinary returned no result"));
              else resolve({ secure_url: r.secure_url });
            },
          )
          .end(result.audio);
      },
    );
    uploadedUrl = uploaded.secure_url;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Sample upload failed: ${msg}` },
      { status: 502 },
    );
  }

  // Pin the URL in Firestore so future requests skip synthesis entirely.
  await cacheRef.set({
    url: uploadedUrl,
    voice_id: voice.id,
    created_at: new Date().toISOString(),
  });

  return NextResponse.redirect(uploadedUrl, 302);
}

// Quiet unused-import warning when getVoiceById isn't directly referenced
// (we use VOICE_CATALOG.find instead, which is more explicit about the lookup
// happening exactly once per request).
void getVoiceById;
