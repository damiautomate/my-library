import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { uploadFromUrl } from "@/lib/cloudinary-server";
import { getGutenbergBook } from "@/lib/gutenberg";
import {
  parseStandardEbooksUrl,
  probeStandardEbooksEpub,
  findEpubFromPage,
} from "@/lib/standard-ebooks";
import { classifyBook } from "@/lib/anthropic";
import { extractPdfText } from "@/lib/pdf-extract";
import { lookupIsbn, cleanIsbn, isValidIsbn } from "@/lib/isbn-lookup";
import {
  LIFE_DOMAIN_KEYS,
  LIFE_STAGE_KEYS,
  ROOM_KEYS,
  READER_LEVEL_KEYS,
  READING_MODE_KEYS,
  CULTURAL_CONTEXT_KEYS,
  type LifeDomain,
  type LifeStage,
  type Room,
  type ReaderLevel,
  type ReadingMode,
  type CulturalContext,
} from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120; // server-side download + upload + AI can take longer

interface ImportBody {
  /** "gutenberg" | "url" — determines which fetch strategy is used. */
  source: "gutenberg" | "url";
  /** When source = "gutenberg" — the Gutendex book ID. */
  gutenberg_id?: number;
  /** When source = "url" — a Standard Ebooks book page URL, or a direct EPUB URL. */
  url?: string;
  /** Optional title hint (used only for url-mode if we can't derive one). */
  title_hint?: string;
  /** Optional author hint. */
  author_hint?: string;
}

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

function newBookId() {
  return adminDb.collection("books").doc().id;
}

function filterKeys<T extends string>(
  values: string[] | undefined,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<string>(allowed);
  return values.filter((v): v is T => typeof v === "string" && set.has(v));
}

function pickOne<T extends string>(
  v: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (!v) return undefined;
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function cleanFreeForm(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => String(v).trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .filter((v) => /^[a-z0-9_]+$/.test(v) && v.length > 0 && v.length < 50);
}

interface ResolvedSource {
  title_hint: string;
  author_hint?: string;
  epub_url?: string;
  pdf_url?: string;
  cover_url?: string;
  source_label: string;
  source_url: string;
}

/** Resolve the user's request to a set of downloadable URLs. */
async function resolveSource(body: ImportBody): Promise<ResolvedSource> {
  if (body.source === "gutenberg") {
    if (!body.gutenberg_id)
      throw new Error("Missing gutenberg_id");
    const book = await getGutenbergBook(body.gutenberg_id);
    if (!book) throw new Error(`Gutenberg book ${body.gutenberg_id} not found`);
    if (!book.epub_url)
      throw new Error("This Gutenberg book has no EPUB format");
    return {
      title_hint: book.title,
      author_hint: book.authors[0],
      epub_url: book.epub_url,
      cover_url: book.cover_url,
      source_label: "Project Gutenberg",
      source_url: `https://www.gutenberg.org/ebooks/${book.id}`,
    };
  }

  // source === "url"
  if (!body.url) throw new Error("Missing url");
  const url = body.url.trim();

  // Standard Ebooks first
  const seMeta = parseStandardEbooksUrl(url);
  if (seMeta) {
    let epub_url = seMeta.epub_url;
    const ok = await probeStandardEbooksEpub(seMeta);
    if (!ok) {
      // Predicted URL didn't work — scrape the page for the real link
      const found = await findEpubFromPage(seMeta.page_url);
      if (!found)
        throw new Error(
          `Couldn't find an EPUB on this Standard Ebooks page. URL was: ${seMeta.epub_url}`,
        );
      epub_url = found;
    }
    return {
      title_hint: body.title_hint || seMeta.guessed_title,
      author_hint: body.author_hint || seMeta.guessed_author,
      epub_url,
      cover_url: seMeta.cover_url,
      source_label: "Standard Ebooks",
      source_url: seMeta.page_url,
    };
  }

  // Generic URL — assume it points directly to an EPUB or PDF
  const lower = url.toLowerCase();
  if (lower.endsWith(".epub")) {
    return {
      title_hint: body.title_hint || "Untitled",
      author_hint: body.author_hint,
      epub_url: url,
      source_label: "URL",
      source_url: url,
    };
  }
  if (lower.endsWith(".pdf")) {
    return {
      title_hint: body.title_hint || "Untitled",
      author_hint: body.author_hint,
      pdf_url: url,
      source_label: "URL",
      source_url: url,
    };
  }
  throw new Error(
    "URL must be a Standard Ebooks book page, or a direct .epub or .pdf URL",
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: ImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 1. Resolve the source (Gutenberg lookup, SE parse, etc.)
  let src: ResolvedSource;
  try {
    src = await resolveSource(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const bookId = newBookId();
  const notes: string[] = [`Source: ${src.source_label} (${src.source_url})`];

  // 2. Upload EPUB / PDF / cover to Cloudinary
  const folder = `my-library/books/${bookId}`;
  let epubUploadedUrl: string | undefined;
  let epubPublicId: string | undefined;
  let pdfUploadedUrl: string | undefined;
  let pdfPublicId: string | undefined;
  let coverUploadedUrl: string | undefined;
  let coverPublicId: string | undefined;

  if (src.epub_url) {
    try {
      const up = await uploadFromUrl({
        source_url: src.epub_url,
        folder: `${folder}/epub`,
        public_id: `${bookId}-epub-${Date.now()}`,
        resource_type: "raw",
      });
      epubUploadedUrl = up.secure_url;
      epubPublicId = up.public_id;
      notes.push(`Mirrored EPUB to Cloudinary (${up.bytes ?? "?"} bytes).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `EPUB upload failed: ${msg}` },
        { status: 502 },
      );
    }
  }

  if (src.pdf_url) {
    try {
      const up = await uploadFromUrl({
        source_url: src.pdf_url,
        folder: `${folder}/pdf`,
        public_id: `${bookId}-pdf-${Date.now()}`,
        resource_type: "raw",
      });
      pdfUploadedUrl = up.secure_url;
      pdfPublicId = up.public_id;
      notes.push(`Mirrored PDF to Cloudinary.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`PDF upload failed: ${msg}`);
    }
  }

  if (src.cover_url) {
    try {
      const up = await uploadFromUrl({
        source_url: src.cover_url,
        folder: `${folder}/cover`,
        public_id: `${bookId}-cover-${Date.now()}`,
        resource_type: "image",
      });
      coverUploadedUrl = up.secure_url;
      coverPublicId = up.public_id;
      notes.push("Mirrored cover image.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`Cover upload failed (non-fatal): ${msg}`);
    }
  }

  // 3. Get text for AI grounding. Prefer PDF (richer extraction) over EPUB.
  let groundingText = "";
  if (pdfUploadedUrl) {
    groundingText = await extractPdfText(pdfUploadedUrl, 25);
    if (groundingText) notes.push(`PDF text extracted (${groundingText.length} chars).`);
  }

  // 4. Run AI Fill
  let ai;
  try {
    ai = await classifyBook({
      title: src.title_hint,
      author: src.author_hint,
      pdfText: groundingText || undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `AI classification failed: ${msg}` },
      { status: 502 },
    );
  }

  // 5. ISBN supplement only if cover not already set
  let isbnCover: string | undefined;
  if (!coverUploadedUrl) {
    const candidate = cleanIsbn(ai.isbn_13 ?? ai.isbn_10 ?? "");
    if (
      candidate &&
      isValidIsbn(candidate) &&
      (candidate.length === 10 ||
        candidate.startsWith("978") ||
        candidate.startsWith("979"))
    ) {
      const r = await lookupIsbn(candidate);
      if (r?.cover_url) {
        isbnCover = r.cover_url;
        notes.push(`Cover sourced from ISBN ${candidate} via ${r.source}.`);
      }
    }
  }

  // 6. Build the final book doc and write to Firestore
  const now = FieldValue.serverTimestamp();
  const finalCoverUrl = coverUploadedUrl ?? isbnCover ?? "";

  const bookDoc: Record<string, unknown> = {
    id: bookId,
    title: ai.title || src.title_hint,
    subtitle: ai.subtitle ?? "",
    authors:
      ai.authors && ai.authors.length > 0
        ? ai.authors
        : src.author_hint
          ? [src.author_hint]
          : [],
    description: ai.description ?? "",
    publisher: ai.publisher ?? "",
    publication_year: ai.publication_year ?? null,
    page_count: ai.page_count ?? null,
    language: ai.language && /^[a-z]{2}$/.test(ai.language) ? ai.language : "en",
    isbn_10: ai.isbn_10 ?? "",
    isbn_13: ai.isbn_13 ?? "",
    cover_url: finalCoverUrl,
    cover_public_id: coverPublicId ?? "",
    why_this_book: ai.why_this_book ?? "",
    life_domains: filterKeys<LifeDomain>(ai.life_domains, LIFE_DOMAIN_KEYS),
    life_stages: filterKeys<LifeStage>(ai.life_stages, LIFE_STAGE_KEYS),
    rooms: filterKeys<Room>(ai.rooms, ROOM_KEYS),
    reader_level: pickOne<ReaderLevel>(ai.reader_level, READER_LEVEL_KEYS) ?? "intermediate",
    reading_modes: filterKeys<ReadingMode>(ai.reading_modes, READING_MODE_KEYS),
    cultural_contexts: filterKeys<CulturalContext>(
      ai.cultural_contexts,
      CULTURAL_CONTEXT_KEYS,
    ),
    outcomes: cleanFreeForm(ai.outcomes),
    fields: cleanFreeForm(ai.fields),
    status: "draft",
    pairs_with: [],
    parent_books: [],
    child_books: [],
    created_at: now,
    updated_at: now,
    created_by: auth.uid,
  };
  if (pdfUploadedUrl) {
    bookDoc.pdf_url = pdfUploadedUrl;
    bookDoc.pdf_public_id = pdfPublicId;
  }
  if (epubUploadedUrl) {
    bookDoc.epub_url = epubUploadedUrl;
    bookDoc.epub_public_id = epubPublicId;
  }

  await adminDb.collection("books").doc(bookId).set(bookDoc);

  return NextResponse.json({
    book_id: bookId,
    title: bookDoc.title,
    has_pdf: !!pdfUploadedUrl,
    has_epub: !!epubUploadedUrl,
    has_cover: !!finalCoverUrl,
    notes,
  });
}
