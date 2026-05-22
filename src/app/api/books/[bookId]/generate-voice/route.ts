import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { extractPdfFull, type PdfPage } from "@/lib/pdf-extract";
import {
  buildParagraphSSML,
  buildParagraphSSMLNoMarks,
  buildParagraphPlainText,
  getProvider,
  type ParagraphForSSML,
  type Timepoint,
  type TTSProviderId,
} from "@/lib/tts";
import { getVoiceById } from "@/lib/voices";
import type { VoiceSegment } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Each call processes ONE segment, which keeps us well under Vercel's 60-second
// hobby-tier limit (and far under the 300s pro limit). For a 450-page book this
// means ~45 separate HTTP calls from the client — totally workable because the
// client polls until done.
export const maxDuration = 60;

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

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const PAGES_PER_SEGMENT = 10;

/**
 * Decide whether a paragraph candidate is actually a printed page number,
 * running header/footer, SKU code, or similar metadata we should NOT send
 * to TTS or treat as narratable content.
 *
 * Real-world examples found in the books we've tested:
 *   - "5"            → page number, plain digits
 *   - "— 4 —"        → page number wrapped in em-dashes
 *   - "30-0539"      → publisher SKU code on Copeland books
 *   - "iv", "xii"    → roman numeral pagination in front matter
 *
 * The filter is conservative — short heading text like "An Act of Courage"
 * or "Look Up!" must NOT match. The pattern requires the WHOLE paragraph to
 * be metadata-shaped, not just to start with a number.
 */
function isMetadataParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 15) return false;
  if (/^[—–\-·•\s]*\d{1,4}[—–\-·•\s]*$/.test(trimmed)) return true;
  if (/^\d{1,3}[-–]\d{2,5}$/.test(trimmed)) return true;
  if (/^(page|pg\.?|p\.)\s*\d+$/i.test(trimmed)) return true;
  if (/^[—–\-\s]*[ivxlcdm]{1,8}[—–\-\s]*$/i.test(trimmed)) return true;
  if (/^[—–\-·•*\s]+$/.test(trimmed)) return true;
  return false;
}

/** Hard cap on how many chars of a single paragraph we'll send to TTS in
 * one Google call. Google's SSML limit is 5000 chars per request including
 * markup; we keep paragraphs well under that so each one fits in a single
 * call regardless of batching. Paragraphs longer than this (rare — typically
 * only block-quoted Bible chapters or legal preambles) get split at sentence
 * boundaries into pseudo-paragraphs that share the same mark prefix. */
const TTS_PARAGRAPH_CHAR_CAP = 3500;

/**
 * Split a page's extracted text into FULL paragraph strings (no truncation).
 *
 * Previously this function truncated each paragraph to 320 chars to keep
 * the per-segment Firestore document small. That truncation was applied to
 * the SAME text we sent to Google TTS — meaning any paragraph longer than
 * 320 chars got its tail amputated before synthesis, so Google literally
 * never narrated the rest. That was the cause of "audio skipping" reports.
 *
 * Now we keep paragraphs at their natural length. The caller is responsible
 * for any TTS-side chunking (see TTS_PARAGRAPH_CHAR_CAP) and for any storage
 * truncation done at write time.
 */
function splitPageIntoParagraphs(rawPageText: string): string[] {
  if (!rawPageText.trim()) return [];
  return rawPageText
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !isMetadataParagraph(p));
}

/**
 * Split a single paragraph at sentence boundaries into chunks that each fit
 * under TTS_PARAGRAPH_CHAR_CAP. Used for the rare extra-long paragraph that
 * can't fit in one SSML request.
 *
 * Returns the original paragraph in a single-element array if it's already
 * under the cap.
 */
function chunkLongParagraph(text: string): string[] {
  if (text.length <= TTS_PARAGRAPH_CHAR_CAP) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf.length + s.length + 1 <= TTS_PARAGRAPH_CHAR_CAP) {
      buf = buf ? `${buf} ${s}` : s;
    } else {
      if (buf) chunks.push(buf);
      if (s.length <= TTS_PARAGRAPH_CHAR_CAP) {
        buf = s;
      } else {
        // Single sentence exceeds cap — last resort, break at nearest space
        let remaining = s;
        while (remaining.length > TTS_PARAGRAPH_CHAR_CAP) {
          let cut = remaining.lastIndexOf(" ", TTS_PARAGRAPH_CHAR_CAP);
          if (cut === -1) cut = TTS_PARAGRAPH_CHAR_CAP;
          chunks.push(remaining.slice(0, cut));
          remaining = remaining.slice(cut).trimStart();
        }
        buf = remaining;
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

interface PageGroup {
  page_start: number;
  page_end: number;
  pages: PdfPage[];
}

function groupPages(pages: PdfPage[]): PageGroup[] {
  const groups: PageGroup[] = [];
  for (let start = 0; start < pages.length; start += PAGES_PER_SEGMENT) {
    const slice = pages.slice(start, start + PAGES_PER_SEGMENT);
    if (slice.length === 0) continue;
    groups.push({
      page_start: slice[0].page,
      page_end: slice[slice.length - 1].page,
      pages: slice,
    });
  }
  return groups;
}

interface RouteParams {
  params: { bookId: string };
}

interface RequestBody {
  provider?: TTSProviderId;
  /** Set to true to wipe existing voice_segments and start over. */
  reset?: boolean;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }

  const bookId = params.bookId;
  if (!bookId)
    return NextResponse.json({ error: "Missing bookId" }, { status: 400 });

  // Load the book
  const bookRef = adminDb.collection("books").doc(bookId);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists)
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const book = bookSnap.data() ?? {};
  if (!book.pdf_url)
    return NextResponse.json(
      { error: "This book has no PDF to narrate" },
      { status: 400 },
    );

  // Resolve the chosen narrator (Phase 9q). Falls back to the catalog default
  // when book.voice_id is unset, which keeps every pre-9q book working
  // unchanged. The voice's `mode` field drives all the downstream branching:
  // synced → SSML with marks + timepoints; premium → no marks, no timepoints,
  // and (for Chirp 3 HD) no SSML at all. The voice's `provider` field drives
  // which TTS API to call (Google vs AWS Polly — Phase 9s).
  const chosenVoice = getVoiceById(book.voice_id as string | undefined);
  const voiceMode = chosenVoice.mode;
  const isPremium = voiceMode === "premium";
  // Voices that don't accept SSML at all (Chirp 3 HD on Google, Generative
  // on Polly). Provider passes plain text to those.
  const isPlainText =
    chosenVoice.tier === "chirp3-hd" || chosenVoice.tier === "polly-generative";

  // Derive providerId from the voice (9s). Pre-9s callers may have sent
  // body.provider, but we override with the voice's authoritative provider
  // so the route can never be in an inconsistent state where, e.g., body
  // said "google" but the voice is a Polly voice.
  const providerId: TTSProviderId = chosenVoice.provider;

  // Get the provider
  let provider;
  try {
    provider = getProvider(providerId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  // Determine where to resume from. If `reset` is true, wipe and start fresh.
  // Otherwise pick up from voice_segments.length (since segments are appended
  // 1:1 with their index in the page-group list).
  //
  // AUTO-RESET on voice change (9q): if the existing segments were generated
  // with a different voice than the currently-chosen one, mid-book voice
  // switching would produce two-different-narrators audio. Detect that and
  // force a reset so the user re-renders from segment 1 in the new voice.
  // Segments before 9q have no `voice_id` stamped — we treat them as the
  // catalog default for this comparison.
  const existingPrior: VoiceSegment[] = Array.isArray(book.voice_segments)
    ? book.voice_segments
    : [];
  const priorVoiceId =
    existingPrior[0]?.voice_id ?? "en-US-Neural2-D"; // pre-9q default
  const voiceChanged =
    existingPrior.length > 0 && priorVoiceId !== chosenVoice.id;
  const forceReset = body.reset === true || voiceChanged;
  const existing: VoiceSegment[] = forceReset ? [] : existingPrior;
  const nextIndex = existing.length;

  // Extract PDF — but cache the result. For a 500-page book this used to
  // take 10-30s on EVERY segment call (the route fires once per ~10-page
  // segment), which routinely blew through Vercel's 60s function ceiling
  // around segment 6-10. Now we extract once, write the JSON to Cloudinary
  // as a raw asset, store its URL on the book doc, and fetch it on every
  // subsequent call (~300ms over CDN vs. ~20s of pdf.js parsing).
  //
  // Cache lifecycle:
  //   - First call: no cache → extract → upload → store URL on book doc
  //   - Subsequent calls: fetch cached JSON
  //   - body.reset === true: ignore cache → re-extract → overwrite (so a new
  //     PDF upload triggers a fresh extraction)
  //
  // Storage shape on Cloudinary:
  //   resource_type=raw, public_id=`${bookId}-extraction` with overwrite,
  //   so the URL is stable and old extractions get replaced cleanly.
  configureCloudinary();
  let extracted: Awaited<ReturnType<typeof extractPdfFull>> | null = null;
  const cachedUrl = book.voice_extraction_url as string | undefined;
  if (cachedUrl && !body.reset) {
    try {
      const r = await fetch(cachedUrl, { cache: "no-store" });
      if (r.ok) {
        extracted = (await r.json()) as Awaited<
          ReturnType<typeof extractPdfFull>
        >;
      }
    } catch {
      // Fall through to re-extract — cache fetch failures shouldn't block
    }
  }
  if (!extracted) {
    try {
      extracted = await extractPdfFull(book.pdf_url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `PDF extraction failed: ${msg}` },
        { status: 502 },
      );
    }
    // Upload the JSON to Cloudinary and pin the URL on the book doc for
    // future calls. Failure to cache is not fatal — we just lose the speedup
    // on future calls (next call will re-extract from PDF again).
    try {
      const json = JSON.stringify(extracted);
      const cacheUpload = await new Promise<{ secure_url: string }>(
        (resolve, reject) => {
          cloudinary.uploader
            .upload_stream(
              {
                folder: `my-library/books/${bookId}/extraction`,
                public_id: `${bookId}-extraction`,
                resource_type: "raw",
                format: "json",
                overwrite: true,
              },
              (err, result) => {
                if (err || !result)
                  reject(err ?? new Error("Cloudinary returned no result"));
                else resolve({ secure_url: result.secure_url });
              },
            )
            .end(Buffer.from(json));
        },
      );
      await bookRef.update({
        voice_extraction_url: cacheUpload.secure_url,
        updated_at: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[VOICE-EXTRACT-CACHE] Failed to cache extraction for ${bookId}: ${msg}. Next call will re-extract.`,
      );
    }
  }
  if (extracted.pages.filter((p) => p.text.trim()).length === 0) {
    return NextResponse.json(
      {
        error:
          "This PDF has no extractable text (likely scanned images). OCR the PDF first.",
      },
      { status: 422 },
    );
  }

  const groups = groupPages(extracted.pages);
  const total = groups.length;

  // Already done?
  if (nextIndex >= total) {
    return NextResponse.json({
      ok: true,
      done: true,
      processed: existing.length,
      total,
      message: "All segments already generated.",
    });
  }

  // Build the flat paragraph list for this segment, with each one carrying
  // a unique markName so we can map the returned timepoint back to (page,
  // paragraphIndex) at playback time.
  //
  // Each visual paragraph becomes ONE entry in this list (mark = `p{page}-{idx}`).
  // If a paragraph exceeds the per-call SSML size cap, we split it at
  // sentence boundaries into chunks sharing the same `indexOnPage` but with
  // sub-marks (`p{page}-{idx}.{sub}`). At playback the sub-mark prefix maps
  // back to the parent paragraph for highlighting purposes — sub-paragraphs
  // are invisible to the user; they just keep the audio flowing without
  // bumping into Google's 5000-char SSML limit on a single request.
  const group = groups[nextIndex];
  interface FlatParagraph {
    page: number;
    indexOnPage: number;
    text: string;
    markName: string;
  }
  const flat: FlatParagraph[] = [];
  for (const pg of group.pages) {
    const paragraphs = splitPageIntoParagraphs(pg.text);
    paragraphs.forEach((text, idx) => {
      if (!text.trim()) return;
      const chunks = chunkLongParagraph(text);
      if (chunks.length === 1) {
        flat.push({
          page: pg.page,
          indexOnPage: idx,
          text: chunks[0],
          markName: `p${pg.page}-${idx}`,
        });
      } else {
        // Long paragraph split into sub-chunks. Only the FIRST sub-chunk
        // keeps the canonical mark `p{page}-{idx}` (so the highlight binds
        // to the paragraph's start time). Subsequent sub-chunks get
        // sub-marks so timepoints can still be returned, but the lookup
        // in VoiceReader parses the prefix and treats them as the same
        // paragraph.
        chunks.forEach((chunk, subIdx) => {
          flat.push({
            page: pg.page,
            indexOnPage: idx,
            text: chunk,
            markName:
              subIdx === 0
                ? `p${pg.page}-${idx}`
                : `p${pg.page}-${idx}.${subIdx}`,
          });
        });
      }
    });
  }

  if (flat.length === 0) {
    // Empty segment (e.g., all blank pages) — record a placeholder and move on
    const placeholder: VoiceSegment = {
      index: nextIndex + 1,
      url: "",
      page_start: group.page_start,
      page_end: group.page_end,
      duration: 0,
      chars: 0,
    };
    await bookRef.update({
      voice_segments: FieldValue.arrayUnion(placeholder),
      voice_provider: providerId,
      updated_at: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({
      ok: true,
      done: nextIndex + 1 >= total,
      processed: nextIndex + 1,
      total,
      skipped_empty: true,
    });
  }

  // Synthesize. We feed paragraphs as SSML with `<mark>` tags so the API
  // returns timepoints — the EXACT second in the audio where each paragraph
  // starts. This is the ground truth for paragraph-level highlight sync.
  //
  // SSML markup adds overhead, so the practical text length per call is
  // ~3500 chars of paragraph content (provider.maxCharsPerCall is 4500 incl
  // markup). We pack paragraphs into batches that stay under that limit,
  // synthesize each batch, and KEEP TRACK of cumulative audio duration so
  // every timepoint can be normalized to its offset from the start of the
  // full combined segment audio.
  const buffers: Buffer[] = [];
  let segDuration = 0;
  let segChars = 0;
  const allTimepoints: Timepoint[] = [];

  // Phase 9q — pick the input builder based on voice mode. Synced uses
  // SSML with <mark> tags so we get timepoints; premium-Studio uses SSML
  // without marks (Studio voices reject marks); premium-Chirp uses plain
  // text (Chirp 3 HD rejects all SSML). All three return a string that the
  // provider can consume — only the synthesize args differ below.
  const buildBatchInput = (paragraphs: FlatParagraph[]): string => {
    const cast = paragraphs as ParagraphForSSML[];
    if (!isPremium) return buildParagraphSSML(cast);
    if (isPlainText) return buildParagraphPlainText(cast);
    return buildParagraphSSMLNoMarks(cast);
  };

  // Pack into batches whose payload stays under maxCharsPerCall. We probe by
  // building the input and checking length.
  interface SsmlBatch {
    paragraphs: FlatParagraph[];
    input: string;
  }
  const batches: SsmlBatch[] = [];
  {
    let currentBatch: FlatParagraph[] = [];
    for (const p of flat) {
      const trial = [...currentBatch, p];
      const trialInput = buildBatchInput(trial);
      if (
        trialInput.length > provider.maxCharsPerCall &&
        currentBatch.length > 0
      ) {
        // Flush the previous batch and start a new one with this paragraph
        batches.push({
          paragraphs: currentBatch,
          input: buildBatchInput(currentBatch),
        });
        currentBatch = [p];
      } else if (trialInput.length > provider.maxCharsPerCall) {
        // Single paragraph alone exceeds limit — synthesize it standalone.
        // For synced mode this still includes the mark; for premium it just
        // synthesizes the text with whatever wrappers the builder applies.
        batches.push({
          paragraphs: [p],
          input: buildBatchInput([p]),
        });
        currentBatch = [];
      } else {
        currentBatch = trial;
      }
    }
    if (currentBatch.length > 0) {
      batches.push({
        paragraphs: currentBatch,
        input: buildBatchInput(currentBatch),
      });
    }
  }

  try {
    for (const batch of batches) {
      // Synced voices receive SSML and request timepoints; premium voices
      // either receive SSML (Studio — no marks) or plain text (Chirp 3 HD),
      // and skip timepointing entirely. The provider's synthesize call
      // accepts both shapes — see src/lib/tts.ts.
      const r = isPlainText
        ? await provider.synthesize({
            text: batch.input,
            voiceId: chosenVoice.id,
            languageCode: chosenVoice.languageCode,
            requestTimepoints: false,
          })
        : await provider.synthesize({
            ssml: batch.input,
            voiceId: chosenVoice.id,
            languageCode: chosenVoice.languageCode,
            requestTimepoints: !isPremium,
          });
      buffers.push(r.audio);
      // Premium-mode batches return no timepoints — skip the offset bookkeeping.
      if (!isPremium) {
        // CRITICAL: Each batch's timepoints are relative to ITS audio's start.
        // To express them relative to the full combined segment audio, we
        // offset by the cumulative duration of all PRIOR batches.
        for (const tp of r.timepoints) {
          allTimepoints.push({
            markName: tp.markName,
            time: tp.time + segDuration,
          });
        }
      }
      segDuration += r.duration;
      segChars += r.chars;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `TTS failed on segment ${nextIndex + 1} (pages ${group.page_start}–${group.page_end}): ${msg}`,
        processed: existing.length,
        total,
      },
      { status: 502 },
    );
  }

  const combined = Buffer.concat(buffers);

  // Upload as Cloudinary "video" resource — that's how Cloudinary serves
  // audio with proper MIME and duration metadata.
  let uploaded;
  try {
    uploaded = await new Promise<{ secure_url: string; duration?: number }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `my-library/books/${bookId}/voice`,
            public_id: `${bookId}-voice-${nextIndex + 1}-${Date.now()}`,
            resource_type: "video",
            format: "mp3",
            overwrite: false,
          },
          (err, result) => {
            if (err || !result)
              reject(err ?? new Error("Cloudinary returned no result"));
            else
              resolve({
                secure_url: result.secure_url,
                duration: result.duration,
              });
          },
        );
        stream.end(combined);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Cloudinary upload failed on segment ${nextIndex + 1}: ${msg}`,
        processed: existing.length,
        total,
      },
      { status: 502 },
    );
  }

  const realDuration = uploaded.duration ?? segDuration;

  // [VOICE-SYNC-9N] One-line diagnostic per segment. If the highlight is in
  // sync, you should see segDuration(parsed) ≈ realDuration(cloudinary) within
  // ~50ms, AND lastTp's time close to (but slightly less than) realDuration.
  // If they diverge, the MP3 frame parser in tts.ts may not be recognizing
  // Google's output — file a phase 9o ticket with this log line.
  const firstTp = allTimepoints[0];
  const lastTp = allTimepoints[allTimepoints.length - 1];
  console.log(
    `[VOICE-SYNC-9N] seg=${nextIndex + 1}/${total} ` +
      `pages=${group.page_start}-${group.page_end} ` +
      `batches=${batches.length} ` +
      `segDuration(parsed)=${segDuration.toFixed(3)}s ` +
      `realDuration(cloudinary)=${realDuration.toFixed(3)}s ` +
      `delta=${(realDuration - segDuration).toFixed(3)}s ` +
      `timepoints=${allTimepoints.length} ` +
      `firstTp=${firstTp ? `${firstTp.markName}@${firstTp.time.toFixed(2)}` : "none"} ` +
      `lastTp=${lastTp ? `${lastTp.markName}@${lastTp.time.toFixed(2)}` : "none"}`,
  );

  // Build pages_paragraphs from the same flat list we sent to TTS, so the
  // markName format (`p{page}-{indexOnPage}`) maps correctly back to a
  // paragraph at playback time. Sub-chunks of an over-long paragraph share
  // the same indexOnPage, so we concatenate them to reconstruct the full
  // paragraph text.
  //
  // We store the FULL paragraph text (not a truncated snippet) so that the
  // PDF highlight matcher can find both the start anchor (first ~80 chars)
  // AND the end anchor (last ~60 chars) at the actual paragraph boundaries
  // — that's what lets the highlight cover the entire visual paragraph
  // instead of just the first few lines.
  //
  // Firestore impact: a 500-page book averages ~250 paragraphs × ~300 chars
  // = ~75 KB of paragraph text per book, well under the 1 MB document limit.
  interface PageBucket {
    page: number;
    paragraphs: string[];
  }
  const pageBuckets = new Map<number, PageBucket>();
  for (const p of flat) {
    let bucket = pageBuckets.get(p.page);
    if (!bucket) {
      bucket = { page: p.page, paragraphs: [] };
      pageBuckets.set(p.page, bucket);
    }
    while (bucket.paragraphs.length <= p.indexOnPage) bucket.paragraphs.push("");
    // If a previous sub-chunk already stored text here, concatenate; this
    // restores the full paragraph for the matcher even though we sent it
    // to Google in multiple SSML calls.
    const existingHere = bucket.paragraphs[p.indexOnPage];
    bucket.paragraphs[p.indexOnPage] = existingHere
      ? `${existingHere} ${p.text}`
      : p.text;
  }
  const pages_paragraphs = Array.from(pageBuckets.values()).sort(
    (a, b) => a.page - b.page,
  );

  const segment: VoiceSegment = {
    index: nextIndex + 1,
    url: uploaded.secure_url,
    page_start: group.page_start,
    page_end: group.page_end,
    duration: realDuration,
    chars: segChars,
    voice_id: chosenVoice.id,
    // Premium-mode segments don't have per-paragraph timing or stored
    // paragraph text — they play as audio-only. Skipping these fields saves
    // ~75 KB per book and keeps the player from trying to display a highlight
    // it can't track.
    ...(isPremium
      ? {}
      : {
          pages_paragraphs,
          paragraph_timepoints: allTimepoints,
        }),
  };

  const newProcessedCount = nextIndex + 1;
  const isDone = newProcessedCount >= total;

  // Append to voice_segments. We also recompute the total seconds on each
  // append so the book doc has a usable summary even mid-generation.
  const newTotalSeconds = existing.reduce((s, x) => s + x.duration, 0) + realDuration;

  const update: Record<string, unknown> = {
    voice_segments: FieldValue.arrayUnion(segment),
    voice_provider: providerId,
    voice_total_seconds: newTotalSeconds,
    voice_id: chosenVoice.id, // pin the chosen voice on the book (9q)
    voice_mode: voiceMode, // synced | premium (9q)
    updated_at: FieldValue.serverTimestamp(),
  };
  // On reset (explicit user wipe OR auto-reset from voice change), replace
  // the array instead of appending so the new voice's segment 1 lands cleanly.
  if (forceReset && existing.length === 0) {
    update.voice_segments = [segment];
  }
  await bookRef.update(update);

  return NextResponse.json({
    ok: true,
    done: isDone,
    processed: newProcessedCount,
    total,
    segment,
    provider: providerId,
  });
}
