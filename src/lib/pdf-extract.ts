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
