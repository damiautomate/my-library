import "server-only";

const MAX_PAGES_DEFAULT = 25;
const MAX_CHARS = 50_000;

/**
 * Extract the first N pages of a PDF as plain text.
 * Used to ground the AI classifier in the actual book contents.
 *
 * Returns an empty string on any failure — callers should fall back to
 * title-only classification rather than crashing.
 */
export async function extractPdfText(
  pdfUrl: string,
  maxPages = MAX_PAGES_DEFAULT,
): Promise<string> {
  try {
    // Pull the PDF bytes from Cloudinary (or wherever).
    const r = await fetch(pdfUrl, { cache: "no-store" });
    if (!r.ok) {
      console.warn(`[pdf-extract] fetch failed: ${r.status} ${pdfUrl}`);
      return "";
    }
    const ab = await r.arrayBuffer();

    // Dynamic import so this doesn't get bundled into client builds. The
    // legacy build is Node-compatible and doesn't need a worker.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(ab),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;

    const pageCount = Math.min(doc.numPages, maxPages);
    const chunks: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((it: unknown) => {
            const item = it as { str?: string };
            return item.str ?? "";
          })
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) chunks.push(`--- Page ${i} ---\n${text}`);
        if (chunks.join("\n\n").length > MAX_CHARS) break;
      } catch (err) {
        console.warn(`[pdf-extract] page ${i} failed`, err);
      }
    }

    try {
      await doc.destroy();
    } catch {}

    return chunks.join("\n\n").slice(0, MAX_CHARS);
  } catch (err) {
    console.warn("[pdf-extract] extraction failed", err);
    return "";
  }
}

/**
 * Build a single page's text WITH paragraph breaks reconstructed from
 * pdfjs text-item positions.
 *
 * Why this matters: pdfjs's getTextContent() returns text fragments with
 * their x/y coordinates but no inherent paragraph structure. A naive
 * concatenation produces one giant line of text per page. Even with
 * `hasEOL` markers, you get line-by-line text with no way to tell whether
 * a line break is mid-paragraph (text wrap) or end-of-paragraph (new block).
 *
 * The algorithm:
 *   1. Group text items into LINES based on similar y-coordinate
 *   2. Sort lines top-to-bottom (PDF y-axis is bottom-up, so descending y)
 *   3. Compute the inter-line gap between consecutive lines
 *   4. A gap > ~1.6× the median line height = PARAGRAPH BREAK
 *      A gap ≤ that = same paragraph, continue with a space
 *
 * The output has `\n\n` between paragraphs, so downstream consumers
 * (voice generation, EPUB conversion) can split on blank lines and get
 * actual paragraph chunks instead of one blob per page.
 */
function buildPageTextWithParagraphs(
  textContent: { items: unknown[] },
): string {
  interface RawItem {
    str?: string;
    transform?: number[];
    height?: number;
  }
  const rawItems = textContent.items as RawItem[];
  if (rawItems.length === 0) return "";

  interface Item {
    str: string;
    x: number;
    y: number;
    h: number;
  }
  const items: Item[] = [];
  for (const it of rawItems) {
    if (!it.str || !it.transform || it.transform.length < 6) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height ?? Math.abs(it.transform[3]) ?? 12;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    items.push({ str: it.str, x, y, h });
  }
  if (items.length === 0) return "";

  // Group into lines by similar y. Items within ~50% of line height
  // count as same-line (handles minor baseline jitter and inline subscripts).
  interface Line {
    y: number;
    height: number;
    items: Item[];
  }
  const lines: Line[] = [];
  for (const item of items) {
    let line = lines.find(
      (l) => Math.abs(l.y - item.y) < Math.max(l.height, item.h) * 0.5,
    );
    if (!line) {
      line = { y: item.y, height: item.h, items: [] };
      lines.push(line);
    } else if (item.h > line.height) {
      line.height = item.h;
    }
    line.items.push(item);
  }

  // Top-to-bottom: in PDF user-space, larger y = higher on page
  lines.sort((a, b) => b.y - a.y);
  // Left-to-right within each line
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }

  // Stitch line text. PDF text items often arrive with NO trailing spaces
  // between fragments, so we add a space when concatenating across items
  // unless the previous fragment already ended in whitespace.
  const lineTexts = lines.map((l) => {
    let out = "";
    for (const it of l.items) {
      if (out && !/\s$/.test(out) && !/^\s/.test(it.str)) out += " ";
      out += it.str;
    }
    return out.replace(/\s+/g, " ").trim();
  });

  // Compute median line height — robust against outlier headers/footers
  const heights = lines.map((l) => l.height).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const medianHeight =
    heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 12;

  // Compute the gap between each consecutive pair of lines — this is what
  // actually distinguishes paragraph breaks from line wraps. Using "line
  // height" as the reference is unreliable because in dense typography a
  // 12pt font often has 14pt line-to-line gaps but 18pt gaps between
  // paragraphs. Using the MEASURED gaps from this specific page gives us
  // a typography-aware threshold.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(lines[i - 1].y - lines[i].y);
  }
  gaps.sort((a, b) => a - b);
  const medianGap =
    gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : medianHeight;

  // Walk top-to-bottom, deciding for each gap whether it's a paragraph
  // break or a line wrap inside a paragraph.
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    const text = lineTexts[i];
    if (!text) continue;
    if (i > 0) {
      const prev = lines[i - 1];
      const curr = lines[i];
      const gap = prev.y - curr.y;
      // Paragraph break threshold: 1.5x the median observed gap. Also
      // require an absolute minimum (1.3x the line height) so a page with
      // all paragraphs tightly packed doesn't get over-split.
      const paragraphThreshold = Math.max(
        medianGap * 1.5,
        medianHeight * 1.3,
      );
      if (gap > paragraphThreshold) {
        result += "\n\n";
      } else {
        // Same paragraph — join with a space (NOT a newline) so the
        // downstream `.split(/\n\s*\n+/)` only splits on real paragraph
        // boundaries.
        result += " ";
      }
    }
    result += text;
  }

  return result;
}

// ----------------------------------------------------------------------------
// Full-book extraction for PDF → EPUB conversion and TTS audio generation.
// ----------------------------------------------------------------------------

export interface PdfPage {
  /** 1-indexed page number. */
  page: number;
  /** Plain text of the page, whitespace-normalized. */
  text: string;
}

export interface PdfOutlineEntry {
  title: string;
  /** 1-indexed page where this entry starts. */
  page: number;
  children: PdfOutlineEntry[];
}

export interface ExtractedPdf {
  total_pages: number;
  pages: PdfPage[];
  outline: PdfOutlineEntry[];
}

/**
 * Extract every page's text plus the outline (if present). Used by:
 *   - PDF → EPUB conversion (chapter detection + per-chapter text)
 *   - TTS voice generation (page-level audio segmentation)
 *
 * For 500-page books, this can take 10-30 seconds and produce 1+ MB of text.
 * Caller should give it a generous timeout.
 */
export async function extractPdfFull(pdfUrl: string): Promise<ExtractedPdf> {
  const r = await fetch(pdfUrl, { cache: "no-store" });
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  const ab = await r.arrayBuffer();

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(ab),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const pages: PdfPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = buildPageTextWithParagraphs(content);
      pages.push({ page: i, text });
    } catch (err) {
      console.warn(`[pdf-extract-full] page ${i} failed`, err);
      pages.push({ page: i, text: "" });
    }
  }

  // Extract outline → flat tree with resolved page numbers
  let outline: PdfOutlineEntry[] = [];
  try {
    const raw = await doc.getOutline();
    if (raw && raw.length > 0) {
      outline = await resolveOutlineEntries(
        raw as unknown as RawOutlineItem[],
        doc as unknown as PdfDocLike,
      );
    }
  } catch (err) {
    console.warn("[pdf-extract-full] outline failed", err);
  }

  try {
    await doc.destroy();
  } catch {}

  return { total_pages: doc.numPages, pages, outline };
}

interface RawOutlineItem {
  title?: string;
  dest?: string | unknown[] | null;
  items?: RawOutlineItem[];
}

interface PdfDocLike {
  getDestination: (name: string) => Promise<unknown[] | null>;
  getPageIndex: (ref: unknown) => Promise<number>;
}

async function resolveOutlineEntries(
  items: RawOutlineItem[],
  doc: PdfDocLike,
): Promise<PdfOutlineEntry[]> {
  const out: PdfOutlineEntry[] = [];
  for (const item of items) {
    let page = 1;
    try {
      let destArr: unknown[] | null = null;
      if (Array.isArray(item.dest)) destArr = item.dest;
      else if (typeof item.dest === "string") {
        destArr = (await doc.getDestination(item.dest)) ?? null;
      }
      if (destArr && destArr.length > 0) {
        const ref = destArr[0];
        if (ref) {
          const idx = await doc.getPageIndex(ref);
          if (typeof idx === "number" && Number.isFinite(idx)) page = idx + 1;
        }
      }
    } catch {
      // Skip entries we can't resolve
    }
    const children = item.items?.length
      ? await resolveOutlineEntries(item.items, doc)
      : [];
    out.push({
      title: (item.title || "Untitled").trim(),
      page,
      children,
    });
  }
  return out;
}
