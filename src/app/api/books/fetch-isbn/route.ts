import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FetchBody {
  isbn?: string;
}

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
  source:
    | "google_books"
    | "google_books_text"
    | "open_library_isbn"
    | "open_library_data";
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

interface GoogleVolumeInfo {
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
}

function googleVolumeToResult(
  v: GoogleVolumeInfo,
  source: "google_books" | "google_books_text",
): IsbnLookupResult {
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
    source,
  };
}

async function tryGoogleBooks(
  query: string,
  apiKey: string | undefined,
  label: string,
): Promise<{
  status: number;
  volumeInfo?: GoogleVolumeInfo;
  totalItems?: number;
  raw?: string;
}> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "5");
  if (apiKey) url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    return { status: res.status, raw: body.slice(0, 300) };
  }
  const data = (await res.json()) as {
    totalItems?: number;
    items?: Array<{ volumeInfo?: GoogleVolumeInfo }>;
  };
  console.info(
    `[fetch-isbn] Google Books ${label} → totalItems=${data.totalItems}`,
  );
  const v = data.items?.[0]?.volumeInfo;
  return { status: 200, volumeInfo: v, totalItems: data.totalItems };
}

async function tryOpenLibraryIsbn(
  isbn: string,
): Promise<IsbnLookupResult | null> {
  const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  console.info(`[fetch-isbn] Open Library /isbn → ${res.status}`);
  if (!res.ok) return null;
  const v = (await res.json()) as {
    title?: string;
    subtitle?: string;
    publishers?: string[];
    publish_date?: string;
    number_of_pages?: number;
    languages?: { key: string }[];
    isbn_10?: string[];
    isbn_13?: string[];
    authors?: { key: string }[];
    covers?: number[];
    description?: string | { value?: string };
  };
  const year = v.publish_date?.match(/(\d{4})/)?.[1];
  const cover = v.covers?.[0]
    ? `https://covers.openlibrary.org/b/id/${v.covers[0]}-L.jpg`
    : undefined;
  const desc =
    typeof v.description === "string" ? v.description : v.description?.value;
  const lang = v.languages?.[0]?.key?.split("/").pop();

  let authors: string[] | undefined;
  if (v.authors && v.authors.length) {
    try {
      authors = await Promise.all(
        v.authors.map(async (a) => {
          const r = await fetch(`https://openlibrary.org${a.key}.json`, {
            cache: "no-store",
          });
          const j = (await r.json()) as { name?: string };
          return j.name ?? "";
        }),
      );
      authors = authors.filter(Boolean);
    } catch (err) {
      console.warn("[fetch-isbn] Open Library author resolution failed", err);
    }
  }

  return {
    title: v.title,
    subtitle: v.subtitle,
    authors,
    publisher: v.publishers?.[0],
    publication_year: year ? Number(year) : undefined,
    description: desc,
    page_count: v.number_of_pages,
    language: lang,
    isbn_10: v.isbn_10?.[0],
    isbn_13: v.isbn_13?.[0],
    cover_url: cover,
    source: "open_library_isbn",
  };
}

async function tryOpenLibraryData(
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
      identifiers?: { isbn_10?: string[]; isbn_13?: string[] };
    }
  >;
  const v = data[`ISBN:${isbn}`];
  console.info(
    `[fetch-isbn] Open Library /api/books → ${v ? "found" : "empty"}`,
  );
  if (!v) return null;

  const year = v.publish_date?.match(/(\d{4})/)?.[1];
  const notes = typeof v.notes === "string" ? v.notes : v.notes?.value;
  return {
    title: v.title,
    subtitle: v.subtitle,
    authors: v.authors?.map((a) => a.name),
    publisher: v.publishers?.[0]?.name,
    publication_year: year ? Number(year) : undefined,
    page_count: v.number_of_pages,
    cover_url: v.cover?.large ?? v.cover?.medium ?? v.cover?.small,
    isbn_10: v.identifiers?.isbn_10?.[0],
    isbn_13: v.identifiers?.isbn_13?.[0],
    description: notes,
    source: "open_library_data",
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

  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  console.info(`[fetch-isbn] Looking up ${isbn} (apiKey: ${!!apiKey})`);

  // ── Tier 1: Google Books, exact ISBN query ───────────────────────────────
  try {
    const r = await tryGoogleBooks(`isbn:${isbn}`, apiKey, "isbn:");
    if (r.status === 200 && r.volumeInfo?.title) {
      return NextResponse.json(
        googleVolumeToResult(r.volumeInfo, "google_books"),
      );
    }
    if (r.status !== 200) {
      console.warn(
        `[fetch-isbn] Google Books isbn: failed → ${r.status} ${r.raw ?? ""}`,
      );
    }
  } catch (err) {
    console.warn("[fetch-isbn] Google Books isbn: threw", err);
  }

  // ── Tier 2: Google Books, plain text — catches editions whose ISBN ───────
  //    index entry is missing but whose volume is in the catalogue. ────────
  try {
    const r = await tryGoogleBooks(isbn, apiKey, "plain");
    if (r.status === 200 && r.volumeInfo?.title) {
      const { isbn_10, isbn_13 } = pickIsbns(
        r.volumeInfo.industryIdentifiers ?? [],
      );
      // Only accept if the returned volume actually carries this ISBN.
      if (
        isbn_10 === isbn ||
        isbn_13 === isbn ||
        isbn_10?.replace(/-/g, "") === isbn ||
        isbn_13?.replace(/-/g, "") === isbn
      ) {
        return NextResponse.json(
          googleVolumeToResult(r.volumeInfo, "google_books_text"),
        );
      }
    }
    if (r.status !== 200) {
      console.warn(
        `[fetch-isbn] Google Books plain failed → ${r.status} ${r.raw ?? ""}`,
      );
    }
  } catch (err) {
    console.warn("[fetch-isbn] Google Books plain threw", err);
  }

  // ── Tier 3: Open Library direct /isbn/{isbn}.json ────────────────────────
  try {
    const ol = await tryOpenLibraryIsbn(isbn);
    if (ol && ol.title) return NextResponse.json(ol);
  } catch (err) {
    console.warn("[fetch-isbn] Open Library /isbn threw", err);
  }

  // ── Tier 4: Open Library data API ────────────────────────────────────────
  try {
    const ol = await tryOpenLibraryData(isbn);
    if (ol && ol.title) return NextResponse.json(ol);
  } catch (err) {
    console.warn("[fetch-isbn] Open Library /api/books threw", err);
  }

  console.info(`[fetch-isbn] All sources missed for ${isbn}`);
  return NextResponse.json(
    {
      error: apiKey
        ? `No book found for ISBN ${isbn} in any source. Try entering details manually.`
        : `No book found for ISBN ${isbn}. (Tip: ask the librarian to set GOOGLE_BOOKS_API_KEY in Vercel to avoid the shared anonymous quota.)`,
    },
    { status: 404 },
  );
}
