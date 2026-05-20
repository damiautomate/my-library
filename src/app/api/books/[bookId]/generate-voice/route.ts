import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { extractPdfFull, type PdfPage } from "@/lib/pdf-extract";
import { getProvider, chunkText, type TTSProviderId } from "@/lib/tts";
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

/** Split a page's extracted text into normalized paragraph snippets. */
function splitPageIntoParagraphs(rawPageText: string): string[] {
  if (!rawPageText.trim()) return [];
  return rawPageText
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
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

  const group = groups[nextIndex];
  const rawText = group.pages
    .map((p) => p.text)
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim();

  if (!rawText) {
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

  // Synthesize. If text exceeds provider limit, split + concat MP3 bytes.
  configureCloudinary();
  const chunks = chunkText(rawText, provider.maxCharsPerCall);
  const buffers: Buffer[] = [];
  let segDuration = 0;
  let segChars = 0;
  try {
    for (const chunk of chunks) {
      const r = await provider.synthesize(chunk);
      buffers.push(r.audio);
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

  // Build pages_paragraphs for downstream paragraph-level highlighting in the
  // PDF/EPUB readers. We split each page's extracted text into paragraphs (by
  // blank-line breaks), truncate each to ~240 chars, and store the array.
  const pages_paragraphs = group.pages.map((p) => ({
    page: p.page,
    paragraphs: splitPageIntoParagraphs(p.text),
  }));

  const segment: VoiceSegment = {
    index: nextIndex + 1,
    url: uploaded.secure_url,
    page_start: group.page_start,
    page_end: group.page_end,
    duration: realDuration,
    chars: segChars,
    pages_paragraphs,
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
