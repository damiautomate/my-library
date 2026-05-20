import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { extractPdfFull, type PdfPage } from "@/lib/pdf-extract";
import {
  buildParagraphSSML,
  getProvider,
  type ParagraphForSSML,
  type Timepoint,
  type TTSProviderId,
} from "@/lib/tts";
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

/** Truncation cap for paragraph snippets stored on each segment. Needs to
 * be long enough that PDFReader's match algorithm can try a middle-window
 * substring (which is more unique than the opening words) without running
 * out of text. 320 chars covers ~50 words, plenty for matching. */
const PARA_SNIPPET_CHARS = 320;

/**
 * Decide whether a paragraph candidate is actually a printed page number,
 * running header/footer, SKU code, or similar metadata we should NOT send
 * to TTS or treat as narratable content.
 *
 * Real-world examples found in the books we've tested:
 *   - "5"            → page number, plain digits
 *   - "— 4 —"        → page number wrapped in em-dashes
 *   - "11"           → page number
 *   - "30-0539"      → publisher SKU code on Copeland books
 *   - "ISBN 978..."  → ISBN line
 *   - "iv", "xii"    → roman numeral pagination in front matter
 *
 * Without this filter, those fragments get fed to Google TTS as paragraphs
 * with their own SSML <mark>, which means:
 *   1. Google narrates them aloud ("...five...", "...thirty oh five thirty
 *      nine...") between every real paragraph — sounds like audio glitches
 *   2. Each one consumes a paragraph slot in pages_paragraphs, so the
 *      highlight matcher briefly tries to find "5" or "30-0539" in the text
 *      layer and produces a meaningless single-character highlight
 *   3. Audio time gets eaten by speaking metadata, making it feel like the
 *      voice is "skipping" between pages
 *
 * The filter is intentionally conservative — short heading text like "An Act
 * of Courage" or "Success Step 1" must NOT match (those are real content).
 * The pattern requires the WHOLE paragraph to be metadata-shaped, not just
 * starting with a number.
 */
function isMetadataParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  // Anything longer than ~15 chars is almost certainly not a page number /
  // SKU / ISBN — real content can be that short ("Look Up!") but the
  // patterns below would never match real content.
  if (trimmed.length > 15) return false;

  // Pure page-number patterns: just digits, optionally wrapped in dashes,
  // em-dashes, or whitespace.
  if (/^[—–\-·•\s]*\d{1,4}[—–\-·•\s]*$/.test(trimmed)) return true;

  // Publisher SKU codes like "30-0539" or "30-8016"
  if (/^\d{1,3}[-–]\d{2,5}$/.test(trimmed)) return true;

  // "Page N" / "p. N" / "pg N"
  if (/^(page|pg\.?|p\.)\s*\d+$/i.test(trimmed)) return true;

  // Roman numerals up to 8 chars (i, ii, iii, iv, v, vi, vii, viii, ix, x,
  // xi, xii, xiii, etc.) — common for front matter pagination
  if (/^[—–\-\s]*[ivxlcdm]{1,8}[—–\-\s]*$/i.test(trimmed)) return true;

  // Pure punctuation / decorative characters
  if (/^[—–\-·•*\s]+$/.test(trimmed)) return true;

  return false;
}

/** Split a page's extracted text into normalized paragraph snippets. */
function splitPageIntoParagraphs(rawPageText: string): string[] {
  if (!rawPageText.trim()) return [];
  return rawPageText
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !isMetadataParagraph(p))
    .map((p) => (p.length > PARA_SNIPPET_CHARS ? p.slice(0, PARA_SNIPPET_CHARS) : p));
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
  const providerId: TTSProviderId = body.provider ?? "google";

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
  const existing: VoiceSegment[] =
    !body.reset && Array.isArray(book.voice_segments)
      ? book.voice_segments
      : [];
  const nextIndex = existing.length;

  // Extract PDF — we have to do this every call because we don't cache the
  // text. Takes 10-30s for big books. The bulk of each call's time budget.
  let extracted;
  try {
    extracted = await extractPdfFull(book.pdf_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `PDF extraction failed: ${msg}` },
      { status: 502 },
    );
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
      flat.push({
        page: pg.page,
        indexOnPage: idx,
        text,
        markName: `p${pg.page}-${idx}`,
      });
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

  configureCloudinary();

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

  // Pack into batches whose SSML stays under maxCharsPerCall. We probe by
  // building the SSML and checking length.
  interface SsmlBatch {
    paragraphs: FlatParagraph[];
    ssml: string;
  }
  const batches: SsmlBatch[] = [];
  {
    let currentBatch: FlatParagraph[] = [];
    for (const p of flat) {
      const trial = [...currentBatch, p];
      const ssml = buildParagraphSSML(trial as ParagraphForSSML[]);
      if (
        ssml.length > provider.maxCharsPerCall &&
        currentBatch.length > 0
      ) {
        // Flush the previous batch and start a new one with this paragraph
        batches.push({
          paragraphs: currentBatch,
          ssml: buildParagraphSSML(currentBatch as ParagraphForSSML[]),
        });
        currentBatch = [p];
      } else if (ssml.length > provider.maxCharsPerCall) {
        // Single paragraph alone exceeds limit — synthesize it as plain text
        // (no mark, so it won't appear in timepoints but the audio still gets
        // produced; the next paragraph's mark will land correctly because
        // batches are independent calls).
        batches.push({
          paragraphs: [p],
          ssml: buildParagraphSSML([p] as ParagraphForSSML[]),
        });
        currentBatch = [];
      } else {
        currentBatch = trial;
      }
    }
    if (currentBatch.length > 0) {
      batches.push({
        paragraphs: currentBatch,
        ssml: buildParagraphSSML(currentBatch as ParagraphForSSML[]),
      });
    }
  }

  try {
    for (const batch of batches) {
      const r = await provider.synthesize({ ssml: batch.ssml });
      buffers.push(r.audio);
      // CRITICAL: Each batch's timepoints are relative to ITS audio's start.
      // To express them relative to the full combined segment audio, we
      // offset by the cumulative duration of all PRIOR batches.
      for (const tp of r.timepoints) {
        allTimepoints.push({
          markName: tp.markName,
          time: tp.time + segDuration,
        });
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

  // Build pages_paragraphs from the same flat list we sent to TTS, so the
  // markName format (`p{page}-{indexOnPage}`) maps correctly back to a
  // paragraph at playback time. We also store the timepoints we captured
  // from Google's response — together these give VoiceReader exact paragraph
  // boundaries instead of having to estimate.
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
    // Ensure the array is indexed by indexOnPage (fill gaps with empties)
    while (bucket.paragraphs.length <= p.indexOnPage) bucket.paragraphs.push("");
    bucket.paragraphs[p.indexOnPage] = p.text;
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
    pages_paragraphs,
    paragraph_timepoints: allTimepoints,
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
    updated_at: FieldValue.serverTimestamp(),
  };
  // On reset, replace the array instead of appending
  if (body.reset && existing.length === 0) {
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
