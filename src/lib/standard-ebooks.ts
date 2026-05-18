import "server-only";

/**
 * Standard Ebooks gated their OPDS catalogue feed behind a Patrons Circle
 * subscription. We can't search programmatically. But individual book pages
 * are public. The user pastes a book URL like:
 *
 *   https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long
 *
 * From there we either:
 *   (a) construct the predictable EPUB download URL directly, or
 *   (b) fetch the page and look for the EPUB <link> element
 *
 * Approach: try (a) first since it's deterministic; fall back to (b) if needed.
 *
 * EPUB URLs follow this pattern:
 *   https://standardebooks.org/ebooks/{author}/{title}[/{translator}]/downloads/{slug}.epub
 * where {slug} = author_title[_translator] with hyphens replaced by underscores.
 */

export interface StandardEbooksMeta {
  author_slug: string;
  title_slug: string;
  translator_slug?: string;
  epub_url: string;
  cover_url?: string;
  page_url: string;
  guessed_title: string;
  guessed_author: string;
}

function unslug(s: string): string {
  return s
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Parse a Standard Ebooks book page URL into its slug components and predict
 * the EPUB download URL. Returns null if the URL isn't a recognizable SE book.
 */
export function parseStandardEbooksUrl(
  url: string,
): StandardEbooksMeta | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!parsed.hostname.endsWith("standardebooks.org")) return null;

  // Expected path: /ebooks/{author}/{title}[/{translator}][/]
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "ebooks" || parts.length < 3) return null;

  const author_slug = parts[1];
  const title_slug = parts[2];
  const translator_slug = parts[3];

  // SE EPUB slug pattern. Hyphens in path segments stay; segments are
  // joined with underscores in the filename.
  const slug = translator_slug
    ? `${author_slug}_${title_slug}_${translator_slug}`
    : `${author_slug}_${title_slug}`;

  const pagePath = translator_slug
    ? `/ebooks/${author_slug}/${title_slug}/${translator_slug}`
    : `/ebooks/${author_slug}/${title_slug}`;
  const page_url = `https://standardebooks.org${pagePath}`;
  const epub_url = `${page_url}/downloads/${slug}.epub`;
  const cover_url = `${page_url}/downloads/cover.jpg`;

  return {
    author_slug,
    title_slug,
    translator_slug,
    epub_url,
    cover_url,
    page_url,
    guessed_title: unslug(title_slug),
    guessed_author: unslug(author_slug),
  };
}

/**
 * Probe the EPUB URL with HEAD to verify it exists. If our predicted URL is
 * wrong (Standard Ebooks occasionally adjusts file names), the caller can
 * fall back to fetching the page HTML and parsing the actual <link>.
 */
export async function probeStandardEbooksEpub(
  meta: StandardEbooksMeta,
): Promise<boolean> {
  try {
    const r = await fetch(meta.epub_url, { method: "HEAD", redirect: "follow" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Fallback: fetch the SE book page and extract the EPUB link from the HTML.
 * SE uses `<link rel="alternate" type="application/epub+zip" href="…">`.
 */
export async function findEpubFromPage(
  pageUrl: string,
): Promise<string | null> {
  try {
    const r = await fetch(pageUrl, { cache: "no-store" });
    if (!r.ok) return null;
    const html = await r.text();
    // Try the alternate-link pattern first
    const altRe =
      /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/epub\+zip["'][^>]+href=["']([^"']+)["']/i;
    const m = html.match(altRe);
    if (m) return new URL(m[1], pageUrl).toString();
    // Fallback: any href ending in .epub on the page
    const epubRe = /href=["']([^"']+?\.epub)["']/i;
    const m2 = html.match(epubRe);
    if (m2) return new URL(m2[1], pageUrl).toString();
    return null;
  } catch {
    return null;
  }
}
