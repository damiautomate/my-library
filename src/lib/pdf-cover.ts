"use client";

import { pdfjs } from "react-pdf";
import { proxyFileUrl, uploadFile } from "./cloudinary";
import { updateBook } from "./books";

/**
 * Width in CSS pixels to render the cover at. The book-detail hero shows the
 * cover at roughly 300px wide, so 700 leaves headroom for high-DPI screens
 * without producing a needlessly large upload.
 */
const COVER_WIDTH = 700;

/** JPEG quality — 0.85 is visually lossless for book covers at this size. */
const JPEG_QUALITY = 0.85;

/**
 * react-pdf configures the worker when PDFReader mounts, but the admin pages
 * that call this never mount a reader. Setting it here is idempotent and uses
 * the exact same CDN URL PDFReader does, so both paths share one worker build.
 */
function ensureWorker(): void {
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
}

/**
 * Render page 1 of a book's PDF to a JPEG blob.
 *
 * Nearly every PDF in the catalogue opens on its own cover art, which is far
 * better than anything ISBN lookup can find for small-press titles — several
 * of which have no cover on OpenLibrary or Google Books at all. Rendering
 * happens in the browser because server-side rasterisation would need a
 * native canvas binding; pdfjs is already a dependency here for the reader.
 */
export async function renderPdfCoverBlobFromUrl(url: string): Promise<Blob> {
  ensureWorker();

  const loadingTask = pdfjs.getDocument({ url });

  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / unscaled.width });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D canvas context");

    // PDF pages have no background of their own. Without this fill, any
    // transparent region renders black once flattened into a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Canvas produced no image data")),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
  } finally {
    // Release the worker's copy of the document either way; a leaked PDF
    // handle keeps the whole file in memory.
    if (pdf) await pdf.destroy();
  }
}

/**
 * Render page 1 of a saved book's PDF, via the authenticated same-origin file
 * proxy. Only works once pdf_url has actually been written to the book doc.
 */
export async function renderPdfCoverBlob(bookId: string): Promise<Blob> {
  return renderPdfCoverBlobFromUrl(await proxyFileUrl(bookId, "pdf"));
}

/**
 * Render page 1 from an arbitrary PDF URL and upload it as this book's cover.
 * Returns the uploaded cover URL WITHOUT touching Firestore — used from the
 * book form, where the PDF has been uploaded but the document hasn't been
 * saved yet, so the caller sets cover_url as part of its own save.
 */
export async function uploadCoverFromPdfUrl(
  bookId: string,
  pdfUrl: string,
): Promise<string> {
  const blob = await renderPdfCoverBlobFromUrl(pdfUrl);
  const file = new File([blob], `${bookId}-cover.jpg`, { type: "image/jpeg" });
  const uploaded = await uploadFile({ file, kind: "cover", bookId });
  return uploaded.secure_url;
}

/**
 * Render page 1, upload it as this book's cover, and write cover_url back to
 * Firestore. Returns the new cover URL.
 */
export async function generateCoverFromPdf(bookId: string): Promise<string> {
  const blob = await renderPdfCoverBlob(bookId);
  const file = new File([blob], `${bookId}-cover.jpg`, { type: "image/jpeg" });

  const uploaded = await uploadFile({ file, kind: "cover", bookId });
  await updateBook(bookId, { cover_url: uploaded.secure_url });

  return uploaded.secure_url;
}
