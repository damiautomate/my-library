import "server-only";

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

export function cleanIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn(isbn: string): boolean {
  return /^(\d{9}[\dX]|\d{13})$/.test(isbn);
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
) {
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
    `[isbn-lookup] Google Books ${label} → totalItems=${data.totalItems}`,
  );
  return { status: 200, volumeInfo: data.items?.[0]?.volumeInfo };
}

async function tryOpenLibraryIsbn(
  isbn: string,
): Promise<IsbnLookupResult | null> {
  const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  console.info(`[isbn-lookup] Open Library /isbn → ${res.status}`);
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
      console.warn("[isbn-lookup] author resolution failed", err);
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
    `[isbn-lookup] Open Library /api/books → ${v ? "found" : "empty"}`,
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

/**
 * The 4-tier ISBN lookup. Returns null if no source could find this ISBN.
 * Reused by /api/books/fetch-isbn and /api/books/ai-fill.
 */
export async function lookupIsbn(
  isbn: string,
): Promise<IsbnLookupResult | null> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

  // Tier 1: Google Books exact ISBN
  try {
    const r = await tryGoogleBooks(`isbn:${isbn}`, apiKey, "isbn:");
    if (r.status === 200 && r.volumeInfo?.title) {
      return googleVolumeToResult(r.volumeInfo, "google_books");
    }
  } catch (err) {
    console.warn("[isbn-lookup] Google Books isbn: threw", err);
  }

  // Tier 2: Google Books plain text
  try {
    const r = await tryGoogleBooks(isbn, apiKey, "plain");
    if (r.status === 200 && r.volumeInfo?.title) {
      const { isbn_10, isbn_13 } = pickIsbns(
        r.volumeInfo.industryIdentifiers ?? [],
      );
      if (
        isbn_10 === isbn ||
        isbn_13 === isbn ||
        isbn_10?.replace(/-/g, "") === isbn ||
        isbn_13?.replace(/-/g, "") === isbn
      ) {
        return googleVolumeToResult(r.volumeInfo, "google_books_text");
      }
    }
  } catch (err) {
    console.warn("[isbn-lookup] Google Books plain threw", err);
  }

  // Tier 3: Open Library /isbn
  try {
    const ol = await tryOpenLibraryIsbn(isbn);
    if (ol && ol.title) return ol;
  } catch (err) {
    console.warn("[isbn-lookup] Open Library /isbn threw", err);
  }

  // Tier 4: Open Library /api/books
  try {
    const ol = await tryOpenLibraryData(isbn);
    if (ol && ol.title) return ol;
  } catch (err) {
    console.warn("[isbn-lookup] Open Library /api/books threw", err);
  }

  return null;
}
