"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { addHighlight, makeDebouncedSaver } from "@/lib/progress";

// Worker is served from a CDN at the exact version react-pdf bundles.
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

interface PDFReaderProps {
  url: string;
  userId: string;
  bookId: string;
  /** Initial page (1-indexed) — restore where the reader left off. */
  initialPage?: number;
  onPercentChange?: (pct: number) => void;
}

export function PDFReader({
  url,
  userId,
  bookId,
  initialPage,
  onPercentChange,
}: PDFReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState<number>(initialPage ?? 1);
  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState<number>(800);
  const containerRef = useRef<HTMLDivElement>(null);

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1500),
    [userId, bookId],
  );

  // Responsive page width
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const measure = () => {
      const w = Math.min(el.clientWidth - 16, 1100);
      setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Save progress whenever page or numPages changes
  useEffect(() => {
    if (!numPages) return;
    const pct = Math.round((page / numPages) * 100);
    saver.save({ current_page: page, current_percent: pct });
    onPercentChange?.(pct);
  }, [page, numPages, saver, onPercentChange]);

  // Also save every 10 seconds while the reader is open (spec §16)
  useEffect(() => {
    if (!numPages) return;
    const id = setInterval(() => {
      const pct = Math.round((page / numPages) * 100);
      saver.save({ current_page: page, current_percent: pct });
    }, 10_000);
    return () => clearInterval(id);
  }, [page, numPages, saver]);

  // Flush on unmount so closing the reader persists the last known page
  useEffect(() => {
    return () => {
      void saver.flush();
    };
  }, [saver]);

  const handleLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      // Clamp initial page if it's beyond the doc
      if (page > n) setPage(n);
    },
    [page],
  );

  function go(delta: number) {
    setPage((p) => {
      if (!numPages) return p;
      return Math.max(1, Math.min(numPages, p + delta));
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);

  // ---- Highlight capture ------------------------------------------------
  const [selection, setSelection] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  // Detect text selection inside the page container
  useEffect(() => {
    function handleSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text || text.length < 2) {
        setSelection(null);
        return;
      }
      // Only handle selections inside the page container
      const node = sel.anchorNode;
      if (!node || !pageContainerRef.current?.contains(node)) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelection({ text, rect });
    }
    document.addEventListener("selectionchange", handleSelection);
    return () => document.removeEventListener("selectionchange", handleSelection);
  }, []);

  async function captureHighlight() {
    if (!selection) return;
    try {
      await addHighlight(userId, bookId, {
        page,
        text: selection.text,
        color: "yellow",
      });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    } catch (err) {
      console.error("[pdf] saveHighlight failed", err);
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col items-center">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 mb-3 flex w-full items-center justify-center gap-3 border-b ml-hairline bg-parchment-50/95 px-4 py-2 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={page <= 1}
          className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-mono text-xs text-ink-700">
          {page} {numPages ? `/ ${numPages}` : ""}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={!numPages || page >= numPages}
          className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100 disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
        <div className="mx-2 h-4 w-px bg-ink-500/20" />
        <button
          type="button"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
          className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100"
          aria-label="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-500">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
          className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100"
          aria-label="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      {/* Floating selection action */}
      {selection && (
        <div
          className="fixed z-20"
          style={{
            top: Math.max(80, selection.rect.top - 44),
            left: Math.min(
              window.innerWidth - 160,
              selection.rect.left + selection.rect.width / 2 - 70,
            ),
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => {
              // Prevent selection clear before click fires
              e.preventDefault();
            }}
            onClick={captureHighlight}
            className="inline-flex items-center gap-1.5 rounded-sm border border-gold-500 bg-parchment-50 px-3 py-1.5 text-xs font-medium text-ink-900 shadow-paper-lg hover:bg-parchment-100"
          >
            <Highlighter size={12} className="text-gold-600" />
            Save highlight
          </button>
        </div>
      )}

      {savedToast && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-sm border border-forest-600/40 bg-forest-50 px-4 py-2 text-sm text-forest-600 shadow-paper-lg">
          ✓ Highlight saved
        </div>
      )}

      <div ref={pageContainerRef}>
        <Document
          file={url}
          onLoadSuccess={handleLoadSuccess}
          loading={
            <div className="flex flex-col items-center gap-2 py-16 text-ink-500">
              <Loader2 className="animate-spin" />
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em]">
                Loading document…
              </p>
            </div>
          }
          error={
            <div className="py-16 text-center text-oxblood-700">
              <p className="font-display text-lg">Could not load this PDF.</p>
              <p className="mt-2 text-sm text-ink-600">
                The file may be missing or corrupted.
              </p>
            </div>
          }
          className="shadow-paper-lg"
        >
          <Page
            pageNumber={page}
            width={width * scale}
            renderTextLayer
            renderAnnotationLayer
          />
        </Document>
      </div>
    </div>
  );
}
