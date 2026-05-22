import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { callAnthropic, stripFences } from "@/lib/anthropic";
import {
  VOICE_CATALOG,
  getVoiceById,
  type VoiceMeta,
} from "@/lib/voices";
import type { BookDoc } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/books/[bookId]/suggest-voice — AI narrator picker (Phase 9q).
 *
 * Reads the book's classification metadata (title, authors, life_domains,
 * reading_modes, description) and a small sample of the book's text (if the
 * voice-extraction cache is warm), then asks Claude Haiku to pick the most
 * suitable voice from VOICE_CATALOG and explain the choice in one sentence.
 *
 * Request body:
 *   {
 *     exclude?: string[]   // voice IDs to skip — used when the user asks
 *                          //   for "another suggestion" after seeing the first
 *   }
 *
 * Response:
 *   {
 *     voice_id: string,
 *     voice_mode: "synced" | "premium",
 *     display_name: string,
 *     reasoning: string,   // one-sentence justification, shown in the UI
 *   }
 *
 * Auth: admin only (same pattern as the other book routes).
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

/** Pull the first ~800 chars of substantive text from the cached PDF
 * extraction. Helps the AI ground its tone judgment in the actual writing
 * style. Returns empty string when the extraction isn't cached yet. */
async function getContentSample(
  voiceExtractionUrl: string | undefined,
): Promise<string> {
  if (!voiceExtractionUrl) return "";
  try {
    const r = await fetch(voiceExtractionUrl, { cache: "no-store" });
    if (!r.ok) return "";
    const data = (await r.json()) as { pages?: Array<{ text?: string }> };
    if (!Array.isArray(data.pages)) return "";
    // Skip front-matter (TOC, copyright, etc.) — take pages 3-5 if available,
    // else fall back to the first real page. Most front-matter is short, so
    // pages with >300 chars are usually body content.
    const meaty = data.pages.filter((p) => (p.text ?? "").length > 300);
    const samplePages = meaty.slice(2, 5).length >= 1
      ? meaty.slice(2, 5)
      : meaty.slice(0, 3);
    const joined = samplePages
      .map((p) => p.text ?? "")
      .join("\n\n")
      .replace(/\s+/g, " ")
      .trim();
    return joined.slice(0, 800);
  } catch {
    return "";
  }
}

function buildPrompt(
  book: BookDoc,
  contentSample: string,
  candidates: VoiceMeta[],
): string {
  const catalog = candidates
    .map(
      (v) =>
        `  - id: "${v.id}", name: "${v.displayName}", provider: ${v.provider}, gender: ${v.gender}, accent: ${v.accent}, mode: ${v.mode}, tone: "${v.description}", bestFor: [${v.bestFor.map((t) => `"${t}"`).join(", ")}]`,
    )
    .join("\n");

  // Concise but information-rich. Includes the trade-off so the AI knows
  // when "premium" is worth the loss of paragraph highlight sync.
  return `You are a voice casting director for an audiobook library. Pick the single best narrator from the catalog below for the given book.

CATALOG:
${catalog}

VOICE MODES:
- "synced" voices support live paragraph highlighting in the reader as the audio plays. Quality is good. Use these for instructional/educational books where the reader will read along, or when in doubt.
- "premium" voices are Google Studio narrators that sound noticeably more human (cinematic delivery, natural emotional range) but DON'T support live highlight. Best for narrative-heavy books people will mostly listen to (fiction, memoir, biography) rather than read along with.

BOOK:
Title: ${book.title}${book.subtitle ? ` — ${book.subtitle}` : ""}
Author(s): ${book.authors?.join(", ") || "Unknown"}
Life domains: ${(book.life_domains || []).join(", ") || "—"}
Reading modes: ${(book.reading_modes || []).join(", ") || "—"}
Description: ${book.description?.slice(0, 400) || "—"}
${contentSample ? `\nWriting sample:\n"${contentSample}"` : ""}

INSTRUCTIONS:
- Consider author's likely gender/voice when no overriding signal — many readers prefer hearing a voice that matches the author's, especially for memoir and personal-development.
- Match tone: faith/devotional → warm/gentle; business/finance → authoritative; literary/classic → British accent; modern fiction → premium if you can justify losing the highlight.
- Don't pick premium unless the book is genuinely better experienced as pure audio (you'll lose the highlight feature). Default to synced.
- The "reasoning" field must be ONE concise sentence (max 25 words) explaining WHY this voice fits THIS book specifically.

Return ONLY this JSON object — no markdown fences, no commentary:
{"voice_id": "<id from catalog>", "reasoning": "<one sentence>"}`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ bookId: string }> },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { bookId } = await ctx.params;
  if (!bookId)
    return NextResponse.json({ error: "Missing bookId" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as {
    exclude?: string[];
  };
  const excludeSet = new Set(body.exclude ?? []);
  const candidates = VOICE_CATALOG.filter((v) => !excludeSet.has(v.id));
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "All voices have been excluded — nothing left to suggest." },
      { status: 422 },
    );
  }

  const bookSnap = await adminDb.collection("books").doc(bookId).get();
  if (!bookSnap.exists)
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const book = bookSnap.data() as BookDoc;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set. Add it to Vercel environment variables.",
      },
      { status: 500 },
    );
  }

  const contentSample = await getContentSample(book.voice_extraction_url);
  const prompt = buildPrompt(book, contentSample, candidates);

  // Haiku is plenty for this — it's a constrained classification task with
  // a tiny output. Sonnet would be overkill and 3x slower.
  let res;
  try {
    res = await callAnthropic(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      },
      apiKey,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `AI suggestion failed: ${msg}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const errBody = await res.text();
    return NextResponse.json(
      { error: `Anthropic API ${res.status}: ${errBody.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find((c) => c.type === "text");
  if (!textBlock?.text) {
    return NextResponse.json(
      { error: "AI returned no text" },
      { status: 502 },
    );
  }

  let parsed: { voice_id?: string; reasoning?: string };
  try {
    parsed = JSON.parse(stripFences(textBlock.text));
  } catch {
    return NextResponse.json(
      {
        error: `AI returned non-JSON output: ${textBlock.text.slice(0, 200)}`,
      },
      { status: 502 },
    );
  }

  // Validate that the chosen voice actually exists in the catalog. If the AI
  // hallucinated an ID, fall back gracefully to the first non-excluded voice
  // rather than erroring out.
  const voice = candidates.find((v) => v.id === parsed.voice_id);
  if (!voice) {
    const fallback = candidates[0];
    return NextResponse.json({
      voice_id: fallback.id,
      voice_mode: fallback.mode,
      display_name: fallback.displayName,
      reasoning:
        parsed.reasoning ||
        `Defaulting to ${fallback.displayName} — the AI suggested an unknown voice ID.`,
      ai_fallback: true,
    });
  }

  return NextResponse.json({
    voice_id: voice.id,
    voice_mode: voice.mode,
    display_name: voice.displayName,
    reasoning: parsed.reasoning?.trim() || `${voice.displayName} fits this book.`,
  });
}
