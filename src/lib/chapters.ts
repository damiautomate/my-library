import type { EpubChapterMapping } from "./types";

/**
 * Resolve which chapter a given source-PDF page falls within (Phase 9t).
 *
 * The chapter map (generated during PDF→EPUB conversion) is a list of
 * `{ source_page_start, title }` entries in ascending page order. A page
 * belongs to the LAST chapter whose start page is <= the page. Example:
 *
 *   chapters: [ {start:1,"Intro"}, {start:12,"Ch 1"}, {start:34,"Ch 2"} ]
 *   page 5  → "Intro"
 *   page 12 → "Ch 1"
 *   page 40 → "Ch 2"
 *
 * Returns null when there's no map, the map is empty, or the page precedes
 * the first chapter start (front matter). Callers fall back to a page label
 * in that case.
 */
export function chapterForPage(
  map: EpubChapterMapping[] | undefined,
  page: number | null | undefined,
): EpubChapterMapping | null {
  if (!map || map.length === 0 || page == null) return null;
  // Defensive copy + sort; the stored map should already be ordered but we
  // don't want a mis-ordered doc to break the lookup.
  const sorted = [...map].sort(
    (a, b) => a.source_page_start - b.source_page_start,
  );
  let current: EpubChapterMapping | null = null;
  for (const ch of sorted) {
    if (ch.source_page_start <= page) current = ch;
    else break;
  }
  return current;
}

/**
 * Short, display-ready chapter label. Falls back to a page label when no
 * chapter is found. Used in the voice reader header and as MediaSession
 * metadata.
 */
export function chapterLabel(
  map: EpubChapterMapping[] | undefined,
  page: number | null | undefined,
): string | null {
  const ch = chapterForPage(map, page);
  if (ch) return ch.title;
  return null;
}
