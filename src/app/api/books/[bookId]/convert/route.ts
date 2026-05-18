import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { extractPdfFull, type PdfOutlineEntry, type PdfPage } from "@/lib/pdf-extract";
import { buildEpub, type EpubChapter } from "@/lib/epub-builder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — big books with full extraction need time

async function requireAdmin(req: NextRequest) {
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

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/**
 * Build the chapter list from extracted pages + outline.
 *
 * If the PDF has a real outline (TOC bookmarks), each top-level entry becomes
 * a chapter and we slice the pages between its start page and the next
 * top-level entry's start page.
 *
 * If there's no outline, we fall back to chunking — one chapter per 20 pages.
 *
 * Each chapter carries its source_pages array (not joined text) so the EPUB
 * builder can emit paragraphs with data-source-page attributes for voice-sync
 * highlighting downstream.
 */
function buildChapters(
  pages: PdfPage[],
  outline: PdfOutlineEntry[],
): EpubChapter[] {
  const pagesInRange = (start: number, endExclusive: number): PdfPage[] =>
    pages.filter((p) => p.page >= start && p.page < endExclusive);

  const top = outline.filter((o) => o.page >= 1);

  if (top.length >= 2) {
    const chapters: EpubChapter[] = [];

    if (top[0].page > 1) {
      const front = pagesInRange(1, top[0].page);
      const totalLen = front.reduce((s, p) => s + p.text.length, 0);
      if (totalLen > 200) {
        chapters.push({
          title: "Front Matter",
          source_pages: front,
          source_page: 1,
        });
      }
    }

    for (let i = 0; i < top.length; i++) {
      const start = top[i].page;
      const end = i < top.length - 1 ? top[i + 1].page : pages.length + 1;
      const slice = pagesInRange(start, end);
      if (slice.some((p) => p.text.trim())) {
        chapters.push({
          title: top[i].title,
          source_pages: slice,
          source_page: start,
        });
      }
    }
    return chapters;
  }

  // No outline — chunk into 20-page sections
  const chunkSize = 20;
  const chapters: EpubChapter[] = [];
  for (let start = 1; start <= pages.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, pages.length + 1);
    const slice = pagesInRange(start, end);
    if (!slice.some((p) => p.text.trim())) continue;
    chapters.push({
      title: `Pages ${start}–${end - 1}`,
      source_pages: slice,
      source_page: start,
    });
  }
  return chapters;
}

interface RouteParams {
  params: { bookId: string };
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const bookId = params.bookId;
  if (!bookId)
    return NextResponse.json({ error: "Missing bookId" }, { status: 400 });

  // Load the book — must exist and have a PDF
  const bookRef = adminDb.collection("books").doc(bookId);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists)
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const book = bookSnap.data() ?? {};
  if (!book.pdf_url)
    return NextResponse.json(
      { error: "This book has no PDF to convert" },
      { status: 400 },
    );

  // Extract
  let extracted;
  try {
    extracted = await extractPdfFull(book.pdf_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `PDF extraction failed: ${msg}` },
      { status: 502 },
    );
  }

  // Filter empty pages — if the PDF was scanned images with no OCR layer,
  // we'd produce a useless EPUB
  const nonEmpty = extracted.pages.filter((p) => p.text.trim().length > 0);
  if (nonEmpty.length < Math.max(2, Math.floor(extracted.total_pages * 0.1))) {
    return NextResponse.json(
      {
        error: `This PDF appears to be image-only (no text layer). Extracted ${nonEmpty.length} of ${extracted.total_pages} pages with usable text — not enough to build an EPUB. The book likely needs OCR before conversion.`,
      },
      { status: 422 },
    );
  }

  // Build the chapters and the EPUB itself
  const chapters = buildChapters(extracted.pages, extracted.outline);
  if (chapters.length === 0) {
    return NextResponse.json(
      { error: "No chapters could be built from the extracted text" },
      { status: 422 },
    );
  }

  let epubBuffer: Buffer;
  try {
    epubBuffer = await buildEpub(
      {
        identifier: `urn:my-library:${bookId}`,
        title: book.title ?? "Untitled",
        authors: Array.isArray(book.authors) ? book.authors : [],
        language: book.language ?? "en",
        publisher: book.publisher,
        description: book.description,
      },
      chapters,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `EPUB build failed: ${msg}` },
      { status: 500 },
    );
  }

  // Upload to Cloudinary as raw
  configureCloudinary();
  let uploaded;
  try {
    uploaded = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `my-library/books/${bookId}/epub`,
            public_id: `${bookId}-epub-converted-${Date.now()}`,
            resource_type: "raw",
            use_filename: false,
            unique_filename: false,
            overwrite: false,
            format: "epub",
          },
          (err, result) => {
            if (err || !result) {
              reject(err ?? new Error("Cloudinary upload returned no result"));
            } else {
              resolve({
                secure_url: result.secure_url,
                public_id: result.public_id,
              });
            }
          },
        );
        stream.end(epubBuffer);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `EPUB upload failed: ${msg}` },
      { status: 502 },
    );
  }

  // Build a chapter -> source page map so the EPUB reader can sync to PDF
  // page numbers later (when the voice reader is at page 47 and the user
  // switches to EPUB, we navigate to the chapter whose source_page_start <= 47).
  const epub_chapter_map = chapters.map((c, i) => ({
    index: i,
    source_page_start: c.source_page ?? 0,
    href: `chapter${i + 1}.xhtml`,
    title: c.title,
  }));

  // Update the book doc
  await bookRef.update({
    epub_url: uploaded.secure_url,
    epub_public_id: uploaded.public_id,
    epub_converted_from_pdf: true,
    epub_chapter_map,
    updated_at: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    ok: true,
    epub_url: uploaded.secure_url,
    chapters: chapters.length,
    pages_with_text: nonEmpty.length,
    total_pages: extracted.total_pages,
    used_outline: extracted.outline.length > 0,
    bytes: epubBuffer.length,
  });
}
