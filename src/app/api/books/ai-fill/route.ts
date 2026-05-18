import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { classifyBook, type ClassifiedBook } from "@/lib/anthropic";
import { extractPdfText } from "@/lib/pdf-extract";
import { cleanIsbn, isValidIsbn, lookupIsbn } from "@/lib/isbn-lookup";
import {
  LIFE_DOMAIN_KEYS,
  LIFE_STAGE_KEYS,
  ROOM_KEYS,
  READER_LEVEL_KEYS,
  READING_MODE_KEYS,
  CULTURAL_CONTEXT_KEYS,
  LANGUAGES,
  type LifeDomain,
  type LifeStage,
  type Room,
  type ReaderLevel,
  type ReadingMode,
  type CulturalContext,
} from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow up to 60 seconds for PDF extraction + Anthropic call + ISBN lookup
export const maxDuration = 60;

interface AiFillBody {
  title?: string;
  author?: string;
  pdf_url?: string;
}

/** Aggregate response we return to the client, ready for form merging. */
export interface AiFillResponse {
  // Core metadata
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publication_year?: number;
  page_count?: number;
  language?: string;
  isbn_10?: string;
  isbn_13?: string;
  // Cover (always from ISBN lookup if AI gave us a valid ISBN)
  cover_url?: string;
  // Curator
  why_this_book?: string;
  // Classification (validated against enums; invalid keys silently dropped)
  life_domains?: LifeDomain[];
  life_stages?: LifeStage[];
  rooms?: Room[];
  reader_level?: ReaderLevel;
  reading_modes?: ReadingMode[];
  cultural_contexts?: CulturalContext[];
  outcomes?: string[];
  fields?: string[];
  // Debug / UX
  meta: {
    used_pdf: boolean;
    pdf_chars: number;
    isbn_source?: string;
    notes: string[];
  };
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
    console.error("[ai-fill] verifyIdToken FAILED", msg);
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

/** Validate a string array against an allowed-keys set. Silently drops invalid. */
function filterKeys<T extends string>(
  values: string[] | undefined,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(values)) return [];
  const set = new Set<string>(allowed);
  return values.filter((v): v is T => typeof v === "string" && set.has(v));
}

function pickOne<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== "string") return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Normalize free-form strings to snake_case lowercase. */
function cleanFreeForm(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => String(v).trim().toLowerCase().replace(/[\s-]+/g, "_"))
    .filter((v) => /^[a-z0-9_]+$/.test(v) && v.length > 0 && v.length < 50);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: AiFillBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json(
      { error: "Title is required so the AI knows what book to classify." },
      { status: 400 },
    );
  }

  const notes: string[] = [];

  // 1. Extract PDF text if a PDF is attached
  let pdfText = "";
  if (body.pdf_url) {
    console.info(`[ai-fill] extracting PDF text from ${body.pdf_url}`);
    pdfText = await extractPdfText(body.pdf_url, 25);
    if (pdfText) {
      notes.push(`Read first ~25 pages (${pdfText.length} chars) for grounding.`);
    } else {
      notes.push("PDF text extraction failed; falling back to title-only.");
    }
  }

  // 2. Ask Claude to classify
  let ai: ClassifiedBook;
  try {
    ai = await classifyBook({
      title,
      author: body.author?.trim() || undefined,
      pdfText: pdfText || undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-fill] classifyBook failed", msg);
    return NextResponse.json(
      { error: `AI classification failed: ${msg}` },
      { status: 502 },
    );
  }

  // 3. If the AI returned an ISBN that looks plausible, supplement with the
  //    ISBN lookup (primarily for cover image, also fills gaps).
  let isbnResult = null;
  let usedIsbn: string | undefined;
  const candidateIsbn = cleanIsbn(ai.isbn_13 ?? ai.isbn_10 ?? "");
  if (candidateIsbn && isValidIsbn(candidateIsbn)) {
    // Sanity check: ISBN-13 must start with 978 or 979
    const sane =
      candidateIsbn.length === 10 ||
      candidateIsbn.startsWith("978") ||
      candidateIsbn.startsWith("979");
    if (sane) {
      console.info(`[ai-fill] AI suggested ISBN ${candidateIsbn}, looking up…`);
      isbnResult = await lookupIsbn(candidateIsbn);
      if (isbnResult) {
        usedIsbn = candidateIsbn;
        notes.push(
          `Looked up AI-suggested ISBN ${candidateIsbn} via ${isbnResult.source}.`,
        );
      } else {
        notes.push(
          `AI-suggested ISBN ${candidateIsbn} not found in any source.`,
        );
      }
    } else {
      notes.push(`Ignored AI ISBN ${candidateIsbn} — doesn't look real.`);
    }
  } else {
    notes.push("AI didn't suggest a confident ISBN.");
  }

  // 4. Merge: AI is primary; ISBN supplements only what AI left empty.
  const response: AiFillResponse = {
    title: ai.title ?? isbnResult?.title ?? title,
    subtitle: ai.subtitle ?? isbnResult?.subtitle,
    authors:
      ai.authors && ai.authors.length > 0
        ? ai.authors
        : isbnResult?.authors,
    description: ai.description ?? isbnResult?.description,
    publisher: ai.publisher ?? isbnResult?.publisher,
    publication_year: ai.publication_year ?? isbnResult?.publication_year,
    page_count: ai.page_count ?? isbnResult?.page_count,
    language:
      (ai.language && Object.keys(LANGUAGES).includes(ai.language)
        ? ai.language
        : undefined) ??
      isbnResult?.language ??
      "en",
    isbn_13: ai.isbn_13 ?? isbnResult?.isbn_13 ?? usedIsbn,
    isbn_10: ai.isbn_10 ?? isbnResult?.isbn_10,
    cover_url: isbnResult?.cover_url, // cover ALWAYS from ISBN (per user spec)
    why_this_book: ai.why_this_book,
    life_domains: filterKeys<LifeDomain>(ai.life_domains, LIFE_DOMAIN_KEYS),
    life_stages: filterKeys<LifeStage>(ai.life_stages, LIFE_STAGE_KEYS),
    rooms: filterKeys<Room>(ai.rooms, ROOM_KEYS),
    reader_level: pickOne<ReaderLevel>(ai.reader_level, READER_LEVEL_KEYS),
    reading_modes: filterKeys<ReadingMode>(ai.reading_modes, READING_MODE_KEYS),
    cultural_contexts: filterKeys<CulturalContext>(
      ai.cultural_contexts,
      CULTURAL_CONTEXT_KEYS,
    ),
    outcomes: cleanFreeForm(ai.outcomes),
    fields: cleanFreeForm(ai.fields),
    meta: {
      used_pdf: !!pdfText,
      pdf_chars: pdfText.length,
      isbn_source: isbnResult?.source,
      notes,
    },
  };

  return NextResponse.json(response);
}
