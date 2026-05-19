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
  ChevronDown,
  ChevronRight as ChevronRightSmall,
  FastForward,
  Headphones,
  Highlighter,
  List,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Rewind,
  X as XIcon,
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
  /** Called when the user advances to a new page. Used by the parent reader
   * page to keep the live page in sync across PDF/Voice/EPUB tabs. */
  onPageChange?: (page: number) => void;
  /** Page currently being narrated by the voice reader. When this changes,
   * the PDF auto-jumps to follow along — so a user reading on the PDF tab
   * while voice plays in the background sees pages flip as the narration
   * advances. A small "Following voice" chip in the toolbar makes this
   * obvious. Pass null to disable following. */
  currentReadingPage?: number | null;
  /** The specific paragraph being narrated right now (page + index + a text
   * snippet for matching). When set, the PDF text layer is searched for the
   * paragraph text and matching spans get the .voice-para-highlight class
   * applied. Requires voice segments generated after Phase 9e. */
  currentReadingParagraph?: {
    page: number;
    paragraphIndex: number;
    text: string;
  } | null;
  /** Whether the voice reader is currently playing — drives the mini-player
   * play/pause icon in the PDF toolbar. */
  voicePlaying?: boolean;
  /** Imperative control callbacks bound to the live VoiceReader. When all
   * three are provided, a compact 4-button audio mini-player appears in the
   * PDF toolbar so the user can pause / nudge ±10s without switching tabs. */
  onVoiceTogglePlay?: () => void;
  onVoiceNudgeBackward?: () => void;
  onVoiceNudgeForward?: () => void;
}

/** Flattened TOC node — what we render in the sidebar. */
interface TocNode {
  title: string;
  page?: number; // resolved page number (1-indexed)
  children: TocNode[];
}

/** Raw outline item shape from pdf.js (loose typing — pdf.js types are messy). */
interface RawOutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  dest?: string | unknown[];
  items?: RawOutlineItem[];
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
  onPageChange,
  currentReadingPage,
  currentReadingParagraph,
  voicePlaying,
  onVoiceTogglePlay,
  onVoiceNudgeBackward,
  onVoiceNudgeForward,
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
  const [showToc, setShowToc] = useState(false);
  const [outline, setOutline] = useState<TocNode[] | null>(null);
  const docRef = useRef<{
    getOutline: () => Promise<unknown[] | null>;
    getDestination: (dest: string) => Promise<unknown>;
    getPageIndex: (ref: unknown) => Promise<number>;
  } | null>(null);
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
    async (info: {
      numPages: number;
      getOutline?: () => Promise<unknown[] | null>;
      getDestination?: (dest: string) => Promise<unknown>;
      getPageIndex?: (ref: unknown) => Promise<number>;
    }) => {
      setNumPages(info.numPages);
      const pct = Math.round(((page - 1) / Math.max(1, info.numPages - 1)) * 100);
      onPercentChange?.(pct);

      // Cache the doc handle so TOC entries can resolve their destinations.
      // CRITICAL: pdfjs methods are unbound — calling them outside their proxy
      // loses `this` and they fail silently. Bind them to `info` here so the
      // resolveOutline calls below actually work. Without the binding, all
      // outline entries end up with `page = undefined` and the buttons in the
      // sidebar render but do nothing on click.
      if (info.getOutline && info.getDestination && info.getPageIndex) {
        const boundGetOutline = info.getOutline.bind(info);
        const boundGetDestination = info.getDestination.bind(info);
        const boundGetPageIndex = info.getPageIndex.bind(info);
        docRef.current = {
          getOutline: boundGetOutline,
          getDestination: boundGetDestination,
          getPageIndex: boundGetPageIndex,
        };
        try {
          const raw = (await boundGetOutline()) as RawOutlineItem[] | null;
          if (raw && raw.length > 0) {
            const resolved = await resolveOutline(
              raw,
              boundGetDestination,
              boundGetPageIndex,
            );
            setOutline(resolved);
          } else {
            setOutline(null);
          }
        } catch (err) {
          console.warn("[pdf] outline parse failed", err);
          setOutline(null);
        }
      }
    },
    [page, onPercentChange],
  );

  const persistProgress = useCallback(
    (newPage: number) => {
      if (!numPages) return;
      const pct = Math.round(((newPage - 1) / Math.max(1, numPages - 1)) * 100);
      onPercentChange?.(pct);
      onPageChange?.(newPage);
      saver.save({
        current_page: newPage,
        current_percent: pct,
      });
    },
    [numPages, onPercentChange, onPageChange, saver],
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

  // Follow the voice reader. When voice is playing in the background and
  // narration advances to a new page, currentReadingPage changes — we jump
  // to that page so the user, who's reading on the PDF tab, sees the page
  // flip in lock-step with the audio. We track the last-followed page in a
  // ref to avoid re-navigating when the voice reader emits the same page
  // twice (it can, e.g. on re-renders or external page sync).
  const lastFollowedPageRef = useRef<number | null>(null);
  useEffect(() => {
    if (currentReadingPage == null) {
      // Voice stopped or paused — release the follow lock so user navigation
      // isn't interfered with.
      lastFollowedPageRef.current = null;
      return;
    }
    if (currentReadingPage === lastFollowedPageRef.current) return;
    if (currentReadingPage === page) {
      // Already on it — just record so we don't try to re-navigate.
      lastFollowedPageRef.current = currentReadingPage;
      return;
    }
    if (!numPages) return; // doc not loaded yet
    lastFollowedPageRef.current = currentReadingPage;
    const clamped = Math.max(1, Math.min(numPages, currentReadingPage));
    setPage(clamped);
    persistProgress(clamped);
  }, [currentReadingPage, page, numPages, persistProgress]);

  // Paragraph-level highlighting in the PDF text layer. When the voice reader
  // broadcasts which paragraph is being narrated (page + a text snippet), we
  // walk the rendered text-layer spans, concatenate their content into one
  // string, find the first ~60 chars of the target paragraph as a substring,
  // and apply .voice-para-highlight to the spans that cover that range.
  //
  // The text layer is rendered transparently over the PDF canvas — adding a
  // background color to those spans creates a colored rectangle over the
  // text on the canvas. CSS for the class is injected globally so it works
  // across all rendered pages.
  const lastHighlightedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentReadingParagraph || currentReadingParagraph.page !== page) {
      // Wrong page or no target — clear any existing highlight
      document
        .querySelectorAll(".voice-para-highlight")
        .forEach((el) => el.classList.remove("voice-para-highlight"));
      lastHighlightedKeyRef.current = null;
      return;
    }
    const key = `${currentReadingParagraph.page}-${currentReadingParagraph.paragraphIndex}`;
    if (lastHighlightedKeyRef.current === key) return;

    const apply = () => {
      const textLayer = document.querySelector(
        ".react-pdf__Page__textContent",
      );
      if (!textLayer) return false;
      // Clear previous
      textLayer
        .querySelectorAll(".voice-para-highlight")
        .forEach((el) => el.classList.remove("voice-para-highlight"));

      const spans = Array.from(
        textLayer.querySelectorAll("span"),
      ) as HTMLElement[];
      if (spans.length === 0) return false;

      // Build concatenated text + per-span offset ranges
      let concat = "";
      const ranges: Array<{ start: number; end: number; el: HTMLElement }> = [];
      for (const span of spans) {
        const start = concat.length;
        const txt = span.textContent ?? "";
        concat += txt;
        ranges.push({ start, end: concat.length, el: span });
        // Add a space between spans so word boundaries match the source text,
        // unless the span already ends in whitespace
        if (txt && !/\s$/.test(txt)) concat += " ";
      }

      // Normalize the target paragraph and the concatenated text the same way
      // (collapse whitespace) so the substring match is robust against
      // line-break differences between pdfjs's extraction and ours.
      const normTarget = currentReadingParagraph.text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      if (normTarget.length < 8) return false;

      // We need to find the target in the (non-normalized) concat to keep
      // span offsets correct. So do a loose case-insensitive search.
      const idx = concat.toLowerCase().indexOf(normTarget.toLowerCase());
      if (idx === -1) return false;
      const endIdx = idx + normTarget.length;

      for (const r of ranges) {
        if (r.end > idx && r.start < endIdx) {
          r.el.classList.add("voice-para-highlight");
        }
      }
      return true;
    };

    // Try immediately, then with a small delay in case the text layer is
    // still rendering (page transitions take ~50-150ms).
    const ok = apply();
    if (ok) {
      lastHighlightedKeyRef.current = key;
    } else {
      const timer = setTimeout(() => {
        if (apply()) lastHighlightedKeyRef.current = key;
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [currentReadingParagraph, page]);

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
          {outline && outline.length > 0 && (
            <button
              type="button"
              onClick={() => setShowToc(true)}
              className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100"
              aria-label="Table of contents"
              title="Table of contents"
            >
              <List size={16} />
            </button>
          )}
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
          {currentReadingPage != null && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-forest-50 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-forest-700"
              title="The voice reader is playing — the PDF is following along page-by-page"
            >
              <Headphones size={11} />
              Following voice · pg {currentReadingPage}
            </span>
          )}
          {/* Audio mini-player — visible whenever the parent has wired up voice
              controls (i.e. the book has voice_segments). Lets you pause /
              nudge ±10s without leaving the PDF tab. */}
          {onVoiceTogglePlay && (
            <div
              className="ml-2 flex items-center gap-0.5 rounded-full border border-oxblood-600/30 bg-parchment-50 px-1 py-0.5"
              role="group"
              aria-label="Audio controls"
            >
              {onVoiceNudgeBackward && (
                <button
                  type="button"
                  onClick={onVoiceNudgeBackward}
                  className="rounded-full p-1 text-ink-700 hover:bg-oxblood-50 hover:text-oxblood-700"
                  title="Rewind 10 seconds"
                  aria-label="Rewind 10 seconds"
                >
                  <Rewind size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={onVoiceTogglePlay}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-oxblood-600 text-parchment-50 hover:bg-oxblood-700"
                title={voicePlaying ? "Pause narration" : "Play narration"}
                aria-label={voicePlaying ? "Pause narration" : "Play narration"}
              >
                {voicePlaying ? (
                  <Pause size={12} fill="currentColor" />
                ) : (
                  <Play size={12} fill="currentColor" />
                )}
              </button>
              {onVoiceNudgeForward && (
                <button
                  type="button"
                  onClick={onVoiceNudgeForward}
                  className="rounded-full p-1 text-ink-700 hover:bg-oxblood-50 hover:text-oxblood-700"
                  title="Forward 10 seconds"
                  aria-label="Forward 10 seconds"
                >
                  <FastForward size={13} />
                </button>
              )}
            </div>
          )}
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
              void handleLoadSuccess(info as unknown as Parameters<typeof handleLoadSuccess>[0]);
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

      {/* TOC sidebar */}
      {showToc && (
        <>
          <div
            className="fixed inset-0 z-30 bg-ink-900/30 backdrop-blur-[1px]"
            onClick={() => setShowToc(false)}
          />
          <TocSidebar
            outline={outline}
            currentPage={page}
            onJump={(p) => {
              jumpTo(p);
              setShowToc(false);
            }}
            onClose={() => setShowToc(false)}
          />
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Outline → TocNode[] resolution
//
// PDF outline entries reference destinations either as a string name (which we
// resolve via getDestination) or as a direct destination array. Both end up as
// an array whose first element is a page reference object. We pass that
// through getPageIndex to get a 0-indexed page number, then +1 for our
// 1-indexed UI.
// ----------------------------------------------------------------------------

async function resolveOutline(
  items: RawOutlineItem[],
  getDestination: (dest: string) => Promise<unknown>,
  getPageIndex: (ref: unknown) => Promise<number>,
): Promise<TocNode[]> {
  const out: TocNode[] = [];
  for (const item of items) {
    let page: number | undefined;
    try {
      let destArr: unknown[] | null = null;
      if (Array.isArray(item.dest)) {
        destArr = item.dest;
      } else if (typeof item.dest === "string") {
        const resolved = (await getDestination(item.dest)) as unknown[] | null;
        destArr = resolved;
      }
      if (destArr && destArr.length > 0) {
        const ref = destArr[0];
        if (ref) {
          const idx = await getPageIndex(ref);
          if (typeof idx === "number" && Number.isFinite(idx)) page = idx + 1;
        }
      }
    } catch {
      // Skip entries we can't resolve — they still appear in the UI without
      // a clickable page jump.
    }
    const children = item.items?.length
      ? await resolveOutline(item.items, getDestination, getPageIndex)
      : [];
    out.push({ title: item.title || "(untitled)", page, children });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Sidebar TOC component
// ----------------------------------------------------------------------------

interface TocSidebarProps {
  outline: TocNode[] | null;
  currentPage: number;
  onJump: (page: number) => void;
  onClose: () => void;
}

function TocSidebar({
  outline,
  currentPage,
  onJump,
  onClose,
}: TocSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] flex-col bg-parchment-50 shadow-paper-lg">
      <header className="flex items-center justify-between border-b ml-hairline px-4 py-3">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
          Table of contents
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1 text-ink-600 hover:bg-parchment-100"
          aria-label="Close table of contents"
        >
          <XIcon size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {!outline || outline.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            This PDF doesn't include a table of contents.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {outline.map((node, i) => (
              <TocEntry
                key={i}
                node={node}
                depth={0}
                currentPage={currentPage}
                onJump={onJump}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function TocEntry({
  node,
  depth,
  currentPage,
  onJump,
}: {
  node: TocNode;
  depth: number;
  currentPage: number;
  onJump: (page: number) => void;
}) {
  const [open, setOpen] = useState(depth < 1); // top-level open by default
  const hasChildren = node.children.length > 0;
  const isCurrent =
    node.page !== undefined && node.page <= currentPage &&
    (node.children.length === 0 ||
      currentPage <
        Math.min(
          ...node.children
            .map((c) => c.page)
            .filter((p): p is number => p !== undefined),
          Infinity,
        ));

  return (
    <li>
      <div
        className={
          "group flex items-start gap-1 rounded-sm px-1.5 py-1 transition-colors " +
          (isCurrent ? "bg-oxblood-50" : "hover:bg-parchment-100")
        }
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex-shrink-0 rounded-sm p-0.5 text-ink-500 hover:text-ink-900"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRightSmall size={12} />
            )}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => node.page !== undefined && onJump(node.page)}
          disabled={node.page === undefined}
          className={
            "min-w-0 flex-1 text-left text-sm leading-snug transition-colors " +
            (node.page !== undefined
              ? "text-ink-800 hover:text-oxblood-700"
              : "cursor-default text-ink-500") +
            (isCurrent ? " text-oxblood-700" : "")
          }
        >
          {node.title}
        </button>
        {node.page !== undefined && (
          <span className="flex-shrink-0 font-mono text-[0.6rem] text-ink-500">
            {node.page}
          </span>
        )}
      </div>
      {open && hasChildren && (
        <ul className="space-y-0.5">
          {node.children.map((c, i) => (
            <TocEntry
              key={i}
              node={c}
              depth={depth + 1}
              currentPage={currentPage}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
