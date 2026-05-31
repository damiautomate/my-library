/**
 * Shared paragraph segmentation (Phase 9v).
 *
 * THE single source of truth for how a page's extracted text is split into
 * paragraphs. Both the voice-generation route AND the EPUB builder import
 * this. They MUST agree on paragraph boundaries and ordering, because the
 * voice reader broadcasts "page P, paragraph index I is narrating now" and
 * the EPUB highlights the element carrying data-page-paragraph-index="I".
 * If the two split differently — or one filters a block the other keeps —
 * the indices drift and the highlight lands on the wrong paragraph.
 *
 * Previously each file had its own copy and they HAD drifted: the route
 * filtered page-number/header noise and indexed the filtered list, while the
 * EPUB builder kept the noise and indexed the unfiltered list. That made the
 * EPUB show junk paragraphs AND mis-target the voice highlight. Consolidating
 * here fixes both at the root.
 */

/**
 * Decide whether a paragraph candidate is actually a printed page number,
 * running header/footer, SKU code, or similar metadata we should NOT treat
 * as narratable / displayable content.
 *
 * Real-world examples found in the books we've tested:
 *   - "5"            → page number, plain digits
 *   - "— 4 —"        → page number wrapped in em-dashes
 *   - "30-0539"      → publisher SKU code on Copeland books
 *   - "iv", "xii"    → roman numeral pagination in front matter
 *
 * Conservative — short heading text like "An Act of Courage" or "Look Up!"
 * must NOT match. The pattern requires the WHOLE paragraph to be
 * metadata-shaped, not merely to start with a number.
 */
export function isMetadataParagraph(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 15) return false;
  if (/^[—–\-·•\s]*\d{1,4}[—–\-·•\s]*$/.test(trimmed)) return true; // page number
  if (/^\d{1,3}[-–]\d{2,5}$/.test(trimmed)) return true; // SKU code
  if (/^(page|pg\.?|p\.)\s*\d+$/i.test(trimmed)) return true; // "Page 12"
  if (/^[—–\-\s]*[ivxlcdm]{1,8}[—–\-\s]*$/i.test(trimmed)) return true; // roman numeral
  if (/^[—–\-·•*\s]+$/.test(trimmed)) return true; // separator rule
  return false;
}

/**
 * Split a page's extracted text into FULL paragraph strings (no truncation).
 *
 * The ordering and count of the returned array IS the paragraph index space
 * that both voice and EPUB rely on. Keep this deterministic. Do not reorder,
 * merge across pages, or conditionally drop blocks beyond the metadata filter
 * — any of those would shift indices and desync the highlight.
 */
export function splitPageIntoParagraphs(rawPageText: string): string[] {
  if (!rawPageText.trim()) return [];
  return rawPageText
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !isMetadataParagraph(p));
}

/**
 * Repair end-of-line hyphenation introduced by the PDF's line wrapping
 * (EPUB display only — does NOT affect paragraph boundaries or indexing).
 *
 * The line-stitcher in pdf-extract joins wrapped lines with a space, so a
 * word hyphenated across a line break arrives as "exam- ple" or "self-
 * conscious". We rejoin a lowercase fragment that follows a hyphen+space:
 *   "exam- ple"        → "example"
 *   "self- conscious"  → "selfconscious"   (acceptable; true compounds that
 *                        wrap are far rarer than ordinary hyphenation, and
 *                        the alternative — leaving "self- conscious" — looks
 *                        worse)
 *
 * We intentionally do NOT join when the next fragment is capitalised
 * ("Anglo- Saxon", "Cobb- Douglas") since those are usually genuine
 * hyphenated proper nouns.
 */
export function repairHyphenation(text: string): string {
  return text.replace(/([A-Za-z])-\s+([a-z])/g, "$1$2");
}

/**
 * Classify a paragraph block as a heading for EPUB presentation (does NOT
 * affect indexing — a heading still occupies its paragraph index so the
 * voice highlight can target it).
 *
 * Returns the heading level (2 or 3) or 0 for body text. Mirrors the heading
 * heuristic used for smart TTS narration so the two stay consistent:
 *   - level 2: structural keyword ("Chapter 5", "Part Two") or an all-caps
 *     multi-word line
 *   - level 3: a short, title-cased line with no terminal punctuation
 *
 * Length-capped at 120 chars to avoid mistaking an un-punctuated last line
 * of body text for a heading.
 */
export function headingLevel(text: string): 0 | 2 | 3 {
  const t = text.trim();
  if (!t || t.length > 120) return 0;
  const endsWithSentence = /[.!?;:,]$/.test(t);
  const wordCount = t.split(/\s+/).length;

  // Structural keyword at the start, not a full sentence → top-level heading.
  if (
    /^(chapter|part|section|appendix|book|prologue|epilogue|introduction|conclusion|preface|foreword|afterword)\b/i.test(
      t,
    ) &&
    !endsWithSentence &&
    wordCount <= 12
  ) {
    return 2;
  }

  // All-caps multi-word line → top-level heading (e.g. "WHY WE FAIL").
  if (/^[A-Z][A-Z0-9'\-&\s]+[A-Z0-9]$/.test(t) && wordCount >= 2 && wordCount <= 12) {
    return 2;
  }

  // Short, capital-led, no terminal punctuation, few words → subheading.
  if (t.length <= 70 && !endsWithSentence && /^[A-Z]/.test(t) && wordCount <= 9) {
    return 3;
  }

  return 0;
}
