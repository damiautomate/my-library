import "server-only";

const GUTENDEX = "https://gutendex.com/books/";

export interface GutenbergBook {
  id: number;
  title: string;
  authors: string[];
  languages: string[];
  subjects: string[];
  bookshelves: string[];
  copyright: boolean;
  download_count: number;
  /** Direct download URLs */
  epub_url?: string;
  cover_url?: string;
  text_url?: string;
}

interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Array<{
    id: number;
    title: string;
    authors: Array<{ name: string; birth_year?: number; death_year?: number }>;
    languages: string[];
    subjects: string[];
    bookshelves: string[];
    copyright: boolean | null;
    download_count: number;
    formats: Record<string, string>;
  }>;
}

function normalize(raw: GutendexResponse["results"][number]): GutenbergBook {
  const formats = raw.formats ?? {};
  // EPUB key may be "application/epub+zip" with or without ".images" suffix in URL
  const epubKey = Object.keys(formats).find((k) =>
    k.startsWith("application/epub+zip"),
  );
  const coverKey = Object.keys(formats).find((k) => k.startsWith("image/"));
  const textKey = Object.keys(formats).find((k) =>
    k.startsWith("text/plain; charset=utf-8"),
  );
  return {
    id: raw.id,
    title: raw.title,
    authors: raw.authors.map((a) => a.name),
    languages: raw.languages,
    subjects: raw.subjects ?? [],
    bookshelves: raw.bookshelves ?? [],
    copyright: raw.copyright ?? false,
    download_count: raw.download_count ?? 0,
    epub_url: epubKey ? formats[epubKey] : undefined,
    cover_url: coverKey ? formats[coverKey] : undefined,
    text_url: textKey ? formats[textKey] : undefined,
  };
}

/** Search Gutendex by free-text. Returns top results, English-language only. */
export async function searchGutenberg(
  query: string,
  options: { englishOnly?: boolean } = {},
): Promise<GutenbergBook[]> {
  const q = query.trim();
  if (!q) return [];
  const url = new URL(GUTENDEX);
  url.searchParams.set("search", q);
  if (options.englishOnly !== false) url.searchParams.set("languages", "en");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Gutendex ${res.status}`);
  const data = (await res.json()) as GutendexResponse;
  return data.results.map(normalize).filter((b) => b.epub_url);
}

/** Look up a single Gutenberg book by ID. */
export async function getGutenbergBook(
  id: number,
): Promise<GutenbergBook | null> {
  const url = `${GUTENDEX}${id}/`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gutendex ${res.status}`);
  const raw = (await res.json()) as GutendexResponse["results"][number];
  return normalize(raw);
}
