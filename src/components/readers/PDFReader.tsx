"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Loader2,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { addHighlight, makeDebouncedSaver } from "@/lib/progress";

// Worker served from jsdelivr (mirrors npm exactly).
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFReaderProps {
  url: string;
  userId: string;
  bookId: string;
  initialPage?: number;
  onPercentChange?: (pct: number) => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.1;

export function PDFReader({
  url,
  userId,
  bookId,
  initialPage,
  onPercentChange,
}: PDFReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState<number>(initialPage ?? 1);
  // The base width = the container's measured CSS pixel width. Scale multiplies it.
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [scale, setScale] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showHint, setShowHint] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pageInput, setPageInput] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1200),
    [userId, bookId],
  );

  // Measure the container width whenever the window resizes
  useLayoutEffect(() => {
    function measure() {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        // Reserve some side padding so the page never butts against the edge
        setContainerWidth(Math.max(280, w - 24));
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const handleLoadSuccess = useCallback(
    (info: { numPages: number }) => {
      setNumPages(info.numPages);
      const pct = Math.round(((page - 1) / Math.max(1, info.numPages - 1)) * 100);
      onPercentChange?.(pct);
    },
    [page, onPercentChange],
  );

  const persistProgress = useCallback(
    (newPage: number) => {
      if (!numPages) return;
      const pct = Math.round(((newPage - 1) / Math.max(1, numPages - 1)) * 100);
      onPercentChange?.(pct);
      saver.save({
        current_page: newPage,
        current_percent: pct,
      });
    },
    [numPages, onPercentChange, saver],
  );

  const go = useCallback(
    (delta: number) => {
      setPage((p) => {
        const next = Math.max(1, Math.min(numPages ?? Infinity, p + delta));
        if (next !== p) persistProgress(next);
        return next;
      });
    },
    [numPages, persistProgress],
  );

  const jumpTo = useCallback(
    (n: number) => {
      if (!numPages) return;
      const clamped = Math.max(1, Math.min(numPages, n));
      setPage(clamped);
      persistProgress(clamped);
    },
    [numPages, persistProgress],
  );

  // ----- Keyboard nav -----------------------------------------------------
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "ArrowRight" || e.key === "PageDown") go(1);
      else if (e.key === "Home") jumpTo(1);
      else if (e.key === "End" && numPages) jumpTo(numPages);
      else if (e.key === "+" || (e.key === "=" && e.shiftKey))
        setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP));
      else if (e.key === "-")
        setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP));
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [go, jumpTo, numPages]);

  // ----- Touch swipe ------------------------------------------------------
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    revealToolbar();
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start) return;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    // Horizontal swipe: at least 50px, mostly horizontal, within 500ms
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 500) {
      if (dx < 0) go(1);
      else go(-1);
    }
  }

  // ----- Tap zones for mobile (left third = prev, right third = next) ----
  function onPageClick(e: React.MouseEvent<HTMLDivElement>) {
    // Only treat as a nav tap if the user clicked the wrapping div, not the page text
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) go(-1);
    else if (x > (rect.width * 2) / 3) go(1);
  }

  // ----- Auto-hide toolbar (idle 3s, reveal on move) ----------------------
  const revealToolbar = useCallback(() => {
    setShowToolbar(true);
    if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    toolbarHideTimerRef.current = setTimeout(() => setShowToolbar(false), 3000);
  }, []);
  useEffect(() => {
    revealToolbar();
    return () => {
      if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    };
  }, [revealToolbar]);

  // ----- Fullscreen -------------------------------------------------------
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch {}
  }, []);
  useEffect(() => {
    function onChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ----- Highlight capture -----------------------------------------------
  const [selection, setSelection] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);
  const [savedToast, setSavedToast] = useState(false);

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
      const node = sel.anchorNode;
      if (!node || !pageWrapperRef.current?.contains(node)) {
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

  // Update pageInput display when page changes
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  function commitPageInput() {
    const n = Number(pageInput);
    if (Number.isFinite(n)) jumpTo(n);
    else setPageInput(String(page));
  }

  // Page width to render at. On mobile, "fit" mode = full container width.
  const effectiveScale = scale;
  const renderWidth = containerWidth * effectiveScale;

  return (
    <div
      ref={containerRef}
      onMouseMove={revealToolbar}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="relative flex w-full flex-col items-center"
      style={isFullscreen ? { background: "#FDFBF5", height: "100vh" } : undefined}
    >
      {/* Auto-hiding toolbar */}
      <div
        className={
          "sticky top-0 z-10 mb-3 flex w-full items-center justify-between gap-3 border-b ml-hairline bg-parchment-50/95 px-3 py-2 backdrop-blur-sm transition-opacity " +
          (showToolbar ? "opacity-100" : "opacity-0 pointer-events-none")
        }
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={page <= 1}
            className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-baseline gap-1 font-mono text-xs text-ink-700">
            <input
              type="text"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={commitPageInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-10 rounded-sm border border-ink-500/20 bg-parchment-50 px-1 py-0.5 text-center font-mono text-xs focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700/20"
              aria-label="Go to page"
            />
            <span className="text-ink-500">/</span>
            <span>{numPages ?? "…"}</span>
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={!numPages || page >= numPages}
            className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}
            className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100"
            aria-label="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-500">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}
            className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100"
            aria-label="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="ml-1 rounded-sm p-2 text-ink-700 hover:bg-parchment-100"
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>

      {/* Progress bar — always visible, even when toolbar hidden */}
      {numPages && (
        <div className="absolute left-0 right-0 top-0 z-20 h-0.5 bg-parchment-200">
          <div
            className="h-full bg-oxblood-600 transition-all"
            style={{ width: `${((page - 1) / Math.max(1, numPages - 1)) * 100}%` }}
          />
        </div>
      )}

      {/* Floating selection action */}
      {selection && (
        <div
          className="fixed z-30"
          style={{
            top: Math.max(80, selection.rect.top - 44),
            left: Math.min(
              window.innerWidth - 160,
              Math.max(10, selection.rect.left + selection.rect.width / 2 - 70),
            ),
          }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
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

      {/* Tap zones — invisible left/right thirds for nav (visible touch hints
          on first load only) */}
      <div
        ref={pageWrapperRef}
        onClick={onPageClick}
        className="relative w-full max-w-full overflow-x-auto"
        style={{ touchAction: "pan-y" }}
      >
        <div className="mx-auto flex justify-center">
          <Document
            file={url}
            onLoadSuccess={(info) => {
              handleLoadSuccess(info);
              // Show the tap-zone hint once after load, for 4 seconds.
              if (typeof window !== "undefined" && window.innerWidth < 768) {
                setShowHint(true);
                setTimeout(() => setShowHint(false), 4000);
              }
            }}
            onLoadError={(err) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error("[pdf] load error", err);
              setLoadError(msg);
            }}
            loading={
              <div className="flex flex-col items-center gap-2 py-16 text-ink-500">
                <Loader2 className="animate-spin" />
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em]">
                  Loading document…
                </p>
              </div>
            }
            error={
              <div className="mx-auto max-w-md py-12 text-center">
                <p className="font-display text-xl text-oxblood-700">
                  Could not load this PDF.
                </p>
                <p className="mt-3 text-sm text-ink-600">
                  The reader received an error while trying to open the file:
                </p>
                <pre className="mt-3 max-h-32 overflow-auto rounded-sm border border-oxblood-600/30 bg-oxblood-50 px-3 py-2 text-left font-mono text-[0.7rem] text-oxblood-700">
                  {loadError ?? "Unknown error"}
                </pre>
                <p className="mt-4 text-xs text-ink-500">
                  If you've just connected this library to a new Cloudinary
                  account, make sure "PDF and ZIP files delivery" is enabled
                  under Cloudinary Console → Settings → Security.
                </p>
              </div>
            }
            className="shadow-paper-lg"
          >
            <Page
              pageNumber={page}
              width={renderWidth}
              renderTextLayer
              renderAnnotationLayer
            />
          </Document>
        </div>
      </div>

      {/* First-time hint about tap zones on mobile */}
      {numPages && showHint && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 mx-auto max-w-sm rounded-sm bg-ink-900/80 px-4 py-2 text-center font-mono text-[0.65rem] uppercase tracking-[0.15em] text-parchment-50 shadow-paper-lg md:hidden">
          Tap left / right · swipe · ← → keys
        </div>
      )}
    </div>
  );
}
