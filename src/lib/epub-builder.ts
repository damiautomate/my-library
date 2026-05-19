import "server-only";
import JSZip from "jszip";

/**
 * Tiny EPUB 3 builder. Produces a valid .epub file from a list of chapters.
 * No images, no embedded fonts, no fancy styling — just clean XHTML wrapped in
 * the minimum structure required by EPUB readers.
 *
 * Why we wrote this instead of using an EPUB library:
 *   - epub-gen (and most NPM libs) depend on Node's fs/path/streams in ways
 *     that don't survive Next.js bundling for Vercel serverless
 *   - JSZip is already a transitive dep via pdfjs-dist and works in any runtime
 *   - The required EPUB structure is small enough to write by hand
 *
 * What's produced (valid against epubcheck for text-only books):
 *   mimetype                         (uncompressed, first file)
 *   META-INF/container.xml           (points to OEBPS/content.opf)
 *   OEBPS/content.opf                (metadata + manifest + spine)
 *   OEBPS/toc.ncx                    (legacy NCX for old readers)
 *   OEBPS/toc.xhtml                  (EPUB 3 nav doc)
 *   OEBPS/styles.css                 (basic typography)
 *   OEBPS/chapter1.xhtml ... chapterN.xhtml
 */

export interface EpubChapter {
  title: string;
  /** Plain text or pre-built HTML for the chapter body. Used when source_pages
   * isn't provided. Backward-compatible with the original API. */
  content?: string;
  /** Preferred for PDF-converted EPUBs: per-page text blocks. When provided,
   * each paragraph gets a data-source-page="N" attribute that lets external
   * readers (the VoiceReader) tell the EPUB which paragraphs to highlight as
   * the audio plays. */
  source_pages?: Array<{ page: number; text: string }>;
  /** Optional: where this chapter starts in the source PDF (used for chapter
   * mapping, displayed in the EPUB internal nav). */
  source_page?: number;
}

export interface EpubMeta {
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  /** A stable ID. Will be used as the EPUB's dc:identifier. */
  identifier: string;
}

const STYLESHEET = `
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; margin: 0; padding: 0; }
h1 { font-size: 1.5em; margin: 1em 0 0.5em 0; line-height: 1.2; }
h2 { font-size: 1.25em; margin: 1em 0 0.5em 0; }
h3 { font-size: 1.1em; margin: 1em 0 0.5em 0; }
p { margin: 0 0 0.8em 0; text-align: left; }
.chapter-title { font-size: 1.6em; font-weight: bold; margin: 1.5em 0 1em 0; text-align: center; }
.page-marker { display: none; }
`.trim();

/** Escape text for XML/HTML attribute or text content. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Turn raw text into safe XHTML paragraphs. Splits on blank lines, escapes
 * each paragraph, and merges short adjacent lines that were probably wrapped
 * mid-sentence in the PDF.
 */
function textToParagraphs(raw: string, sourcePage?: number): string {
  if (!raw.trim()) return "<p>&#160;</p>";

  // Normalise whitespace then split on blank lines
  const blocks = raw
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((b) => b.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const attr = sourcePage !== undefined ? ` data-source-page="${sourcePage}"` : "";
  return blocks.map((p) => `    <p${attr}>${xmlEscape(p)}</p>`).join("\n");
}

/**
 * Build paragraph HTML from per-page source. Each paragraph carries a
 * data-source-page attribute (which PDF page it came from) AND a
 * data-page-paragraph-index attribute (its position within that page's
 * paragraphs, 0-indexed). Together these let the voice reader broadcast
 * "page 47, paragraph 2 is being narrated right now" and the EPUB iframe
 * can highlight exactly one paragraph at a time instead of the whole page.
 */
function pagesToParagraphs(
  sections: Array<{ page: number; text: string }>,
): string {
  const out: string[] = [];
  for (const sec of sections) {
    if (!sec.text.trim()) continue;
    const blocks = sec.text
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n+/)
      .map((b) => b.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    blocks.forEach((block, idx) => {
      out.push(
        `    <p data-source-page="${sec.page}" data-page-paragraph-index="${idx}">${xmlEscape(block)}</p>`,
      );
    });
  }
  return out.length > 0 ? out.join("\n") : "<p>&#160;</p>";
}

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <h1 class="chapter-title">${xmlEscape(title)}</h1>
${body}
</body>
</html>`;
}

function contentOpf(meta: EpubMeta, chapters: EpubChapter[]): string {
  const manifestItems = chapters
    .map(
      (_, i) =>
        `    <item id="chap${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spineItems = chapters
    .map((_, i) => `    <itemref idref="chap${i + 1}"/>`)
    .join("\n");

  const authors = meta.authors.length > 0 ? meta.authors : ["Unknown"];
  const authorTags = authors
    .map(
      (a, i) =>
        `  <dc:creator id="creator-${i}">${xmlEscape(a)}</dc:creator>\n  <meta refines="#creator-${i}" property="role" scheme="marc:relators">aut</meta>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${meta.language ?? "en"}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="pub-id">${xmlEscape(meta.identifier)}</dc:identifier>
    <dc:title>${xmlEscape(meta.title)}</dc:title>
    <dc:language>${meta.language ?? "en"}</dc:language>
${authorTags}
    ${meta.publisher ? `<dc:publisher>${xmlEscape(meta.publisher)}</dc:publisher>` : ""}
    ${meta.description ? `<dc:description>${xmlEscape(meta.description.slice(0, 1000))}</dc:description>` : ""}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="style" href="styles.css" media-type="text/css"/>
    <item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
}

function navXhtml(meta: EpubMeta, chapters: EpubChapter[]): string {
  const lis = chapters
    .map(
      (c, i) =>
        `      <li><a href="chapter${i + 1}.xhtml">${xmlEscape(c.title)}</a></li>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>${xmlEscape(meta.title)} — Table of Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
${lis}
    </ol>
  </nav>
</body>
</html>`;
}

function tocNcx(meta: EpubMeta, chapters: EpubChapter[]): string {
  const navPoints = chapters
    .map(
      (c, i) =>
        `    <navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(c.title)}</text></navLabel>
      <content src="chapter${i + 1}.xhtml"/>
    </navPoint>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${meta.language ?? "en"}">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(meta.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(meta.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/**
 * Build the EPUB zip in memory. Returns a Buffer suitable for direct upload
 * to Cloudinary as a raw resource.
 */
export async function buildEpub(
  meta: EpubMeta,
  chapters: EpubChapter[],
): Promise<Buffer> {
  if (chapters.length === 0) {
    throw new Error("EPUB needs at least one chapter");
  }

  const zip = new JSZip();

  // mimetype MUST be first and uncompressed per the EPUB spec
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);

  zip.file("OEBPS/styles.css", STYLESHEET);
  zip.file("OEBPS/content.opf", contentOpf(meta, chapters));
  zip.file("OEBPS/toc.ncx", tocNcx(meta, chapters));
  zip.file("OEBPS/toc.xhtml", navXhtml(meta, chapters));

  chapters.forEach((c, i) => {
    let body: string;
    if (c.source_pages && c.source_pages.length > 0) {
      // PDF-converted chapter — emit paragraphs with data-source-page attrs
      body = pagesToParagraphs(c.source_pages);
    } else if (c.content) {
      // Pre-built content (HTML) or plain text
      body = c.content.startsWith("<")
        ? c.content
        : textToParagraphs(c.content, c.source_page);
    } else {
      body = "<p>&#160;</p>";
    }
    zip.file(`OEBPS/chapter${i + 1}.xhtml`, chapterXhtml(c.title, body));
  });

  return zip.generateAsync({ type: "nodebuffer" });
}
