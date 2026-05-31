import "server-only";
import JSZip from "jszip";
import {
  splitPageIntoParagraphs,
  repairHyphenation,
  headingLevel,
} from "@/lib/paragraphs";

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
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif;
  line-height: 1.6;
  margin: 0;
  padding: 0 1em;
  color: #1A1410;
  widows: 2;
  orphans: 2;
}
h1, h2, h3 { font-family: inherit; line-height: 1.25; font-weight: 700; }
h1 { font-size: 1.6em; margin: 1.2em 0 0.8em 0; }
h2 {
  font-size: 1.3em;
  margin: 1.6em 0 0.6em 0;
  text-align: left;
  page-break-after: avoid;
  break-after: avoid;
}
h3 {
  font-size: 1.08em;
  margin: 1.3em 0 0.4em 0;
  font-style: italic;
  font-weight: 600;
  page-break-after: avoid;
  break-after: avoid;
}
/* Body paragraphs: justified with a traditional first-line indent. */
p {
  margin: 0;
  text-align: justify;
  text-indent: 1.3em;
  hyphens: auto;
  -webkit-hyphens: auto;
}
/* First paragraph of the chapter, and any paragraph that immediately follows
   a heading, should NOT be indented — standard book typography. */
.chapter-title + p,
h1 + p, h2 + p, h3 + p,
p:first-of-type {
  text-indent: 0;
}
/* A little breathing room between paragraphs in addition to the indent makes
   on-screen reading easier than print-tight leading. */
p + p { margin-top: 0.15em; }
.chapter-title {
  font-size: 1.7em;
  font-weight: 700;
  margin: 1em 0 1.2em 0;
  text-align: center;
  line-height: 1.2;
  text-indent: 0;
}
blockquote {
  border-left: 2px solid rgba(123,45,38,0.4);
  padding-left: 0.9em;
  margin: 1.1em 0;
  font-style: italic;
  color: #4a3f36;
}
blockquote p { text-indent: 0; text-align: left; }
em, i { font-style: italic; }
strong, b { font-weight: 700; }
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
 * Build paragraph/heading HTML from per-page source (Phase 9v rewrite).
 *
 * Indexing contract (DO NOT BREAK): paragraphs are split with the SHARED
 * splitPageIntoParagraphs so the position of each block within a page matches
 * exactly what the voice route used when generating segments. Each block gets:
 *   - data-source-page          → the PDF page it came from
 *   - data-page-paragraph-index → its 0-based position within that page's
 *                                 (filtered) blocks  ← MUST equal the voice
 *                                 reader's paragraphIndex for sync
 *   - id="pg{page}-p{idx}"      → stable anchor the reader navigates to via
 *                                 rendition.display("chapterN.xhtml#id")
 *
 * Presentation (does NOT affect indexing): each block is classified with
 * headingLevel() and emitted as <h2>/<h3>/<p>, and its text is run through
 * repairHyphenation() to fix words broken across PDF line wraps.
 */
function pagesToParagraphs(
  sections: Array<{ page: number; text: string }>,
): string {
  const out: string[] = [];
  for (const sec of sections) {
    const blocks = splitPageIntoParagraphs(sec.text);
    blocks.forEach((block, idx) => {
      const clean = repairHyphenation(block);
      const lvl = headingLevel(clean);
      const attrs = `data-source-page="${sec.page}" data-page-paragraph-index="${idx}" id="pg${sec.page}-p${idx}"`;
      if (lvl === 2) {
        out.push(`    <h2 ${attrs}>${xmlEscape(clean)}</h2>`);
      } else if (lvl === 3) {
        out.push(`    <h3 ${attrs}>${xmlEscape(clean)}</h3>`);
      } else {
        out.push(`    <p ${attrs}>${xmlEscape(clean)}</p>`);
      }
    });
  }
  return out.length > 0 ? out.join("\n") : "<p>&#160;</p>";
}

/**
 * Turn raw text into safe XHTML paragraphs (used for non-page-sourced
 * chapters, e.g. imported plain text). Uses the same shared splitter and
 * heading classification, minus the per-page sync attributes.
 */
function textToParagraphs(raw: string, sourcePage?: number): string {
  const blocks = splitPageIntoParagraphs(raw);
  if (blocks.length === 0) return "<p>&#160;</p>";
  return blocks
    .map((block, idx) => {
      const clean = repairHyphenation(block);
      const lvl = headingLevel(clean);
      const pageAttr =
        sourcePage !== undefined
          ? ` data-source-page="${sourcePage}" data-page-paragraph-index="${idx}" id="pg${sourcePage}-p${idx}"`
          : "";
      if (lvl === 2) return `    <h2${pageAttr}>${xmlEscape(clean)}</h2>`;
      if (lvl === 3) return `    <h3${pageAttr}>${xmlEscape(clean)}</h3>`;
      return `    <p${pageAttr}>${xmlEscape(clean)}</p>`;
    })
    .join("\n");
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
