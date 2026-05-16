import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FetchBody {
  isbn?: string;
}

/** Normalised result the form can consume. */
export interface IsbnLookupResult {
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
  cover_url?: string;
  source: "google_books" | "open_library";
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
    console.error("[fetch-isbn] verifyIdToken FAILED", msg);
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

/** Strip everything but digits; preserves trailing 'X' for ISBN-10. */
function cleanIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function pickIsbns(identifiers: { type: string; identifier: string }[]) {
  let isbn_10: string | undefined;
  let isbn_13: string | undefined;
  for (const i of identifiers ?? []) {
    if (i.type === "ISBN_10") isbn_10 = i.identifier;
    if (i.type === "ISBN_13") isbn_13 = i.identifier;
  }
  return { isbn_10, isbn_13 };
}

async function fromGoogleBooks(
  isbn: string,
): Promise<IsbnLookupResult | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    totalItems?: number;
    items?: Array<{
      volumeInfo?: {
        title?: string;
        subtitle?: string;
        authors?: string[];
        publisher?: string;
        publishedDate?: string;
        description?: string;
        pageCount?: number;
        language?: string;
        industryIdentifiers?: { type: string; identifier: string }[];
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
      };
    }>;
  };

  if (!data.items?.length) return null;
  const v = data.items[0].volumeInfo;
  if (!v) return null;

  const { isbn_10, isbn_13 } = pickIsbns(v.industryIdentifiers ?? []);
  const year = v.publishedDate?.match(/^(\d{4})/)?.[1];
  const cover = (v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail)?.replace(
    /^http:/,
    "https:",
  );

  return {
    title: v.title,
    subtitle: v.subtitle,
    authors: v.authors,
    publisher: v.publisher,
    publication_year: year ? Number(year) : undefined,
    description: v.description,
    page_count: v.pageCount,
    language: v.language,
    isbn_10,
    isbn_13,
    cover_url: cover,
    source: "google_books",
  };
}

async function fromOpenLibrary(
  isbn: string,
): Promise<IsbnLookupResult | null> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<
    string,
    {
      title?: string;
      subtitle?: string;
      authors?: { name: string }[];
      publishers?: { name: string }[];
      publish_date?: string;
      number_of_pages?: number;
      cover?: { small?: string; medium?: string; large?: string };
      notes?: string | { value?: string };
      identifiers?: {
        isbn_10?: string[];
        isbn_13?: string[];
      };
    }
  >;
  const key = `ISBN:${isbn}`;
  const v = data[key];
  if (!v) return null;

  const year = v.publish_date?.match(/(\d{4})/)?.[1];
  const isbn10 = v.identifiers?.isbn_10?.[0];
  const isbn13 = v.identifiers?.isbn_13?.[0];
  const notes = typeof v.notes === "string" ? v.notes : v.notes?.value;

  return {
    title: v.title,
    subtitle: v.subtitle,
    authors: v.authors?.map((a) => a.name),
    publisher: v.publishers?.[0]?.name,
    publication_year: year ? Number(year) : undefined,
    page_count: v.number_of_pages,
    cover_url: v.cover?.large ?? v.cover?.medium ?? v.cover?.small,
    isbn_10: isbn10,
    isbn_13: isbn13,
    description: notes,
    source: "open_library",
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: FetchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isbn = cleanIsbn(body.isbn ?? "");
  if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) {
    return NextResponse.json(
      { error: "Provide a valid ISBN-10 or ISBN-13." },
      { status: 400 },
    );
  }

  // Google first, then Open Library
  try {
    const g = await fromGoogleBooks(isbn);
    if (g && g.title) return NextResponse.json(g);
  } catch (err) {
    console.warn("[fetch-isbn] Google Books error", err);
  }
  try {
    const o = await fromOpenLibrary(isbn);
    if (o && o.title) return NextResponse.json(o);
  } catch (err) {
    console.warn("[fetch-isbn] Open Library error", err);
  }

  return NextResponse.json(
    { error: `No book found for ISBN ${isbn}. Try entering details manually.` },
    { status: 404 },
  );
}
