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
  Check,
  FastForward,
  Headphones,
  List,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PenLine,
  Play,
  Rewind,
  Trash2,
  X as XIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { makeDebouncedSaver } from "@/lib/progress";
import {
  chapterForPageIndex,
  createNote,
  deleteNote,
  emptyAnchor,
  HIGHLIGHT_COLORS,
  watchBookNotes,
} from "@/lib/notes";
import type { EpubChapterMapping, Note, NoteRect } from "@/lib/types";

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
   * applied. Requires voice segments generated after Phase 9e. The nextText /
   * nextIsSamePage fields (Phase 9p) let us anchor the highlight's END
   * boundary on the start of the next paragraph instead of trying to match
   * the current paragraph's tail — far more reliable across PDF layout
   * quirks (ligatures, hyphenation, etc.). */
  currentReadingParagraph?: {
    page: number;
    paragraphIndex: number;
    text: string;
    nextText?: string | null;
    nextIsSamePage?: boolean;
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
  /** Start narration from a given page (tap-to-play). When provided, tapping a
   *  paragraph offers a "Play from here" action. */
  onPlayFromPage?: (page: number) => void;
  /** Chapter map, so a highlight captured on page N is filed under the right
   *  chapter in the notebook (Phase 9z). */
  chapterMap?: EpubChapterMapping[];
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

/**
 * Convert a selection Range into normalised per-line rects (fractions of the
 * page box). Hardened against the "over-highlight" failure mode where the
 * browser returns a tall line-box / container rect that visually covers
 * several lines: we clamp to the page, drop block-height rects, and de-dupe.
 */
function normalizeSelectionRects(range: Range, pageRect: DOMRect): NoteRect[] {
  const out: NoteRect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width <= 1 || r.height <= 1) continue;
    let x = (r.left - pageRect.left) / pageRect.width;
    let y = (r.top - pageRect.top) / pageRect.height;
    let w = r.width / pageRect.width;
    let h = r.height / pageRect.height;
    // Reject rects clearly outside the page (selection handles, margins).
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) continue;
    // Clamp into the page box.
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    // A line of text is short. Anything tall is a block/line-box rect that
    // would over-highlight — skip it. Anything too thin is noise.
    if (h < 0.004 || h > 0.1 || w < 0.004) continue;
    // De-dupe near-identical rects (avoids stacked multiply darkening).
    if (
      out.some(
        (o) =>
          Math.abs(o.x - x) < 0.004 &&
          Math.abs(o.y - y) < 0.006 &&
          Math.abs(o.w - w) < 0.01 &&
          Math.abs(o.h - h) < 0.01,
      )
    )
      continue;
    out.push({ x, y, w, h });
    if (out.length >= 80) break;
  }
  return out;
}

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
  onPlayFromPage,
  chapterMap,
}: PDFReaderProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState<number>(initialPage ?? 1);
  // The base width = the container's measured CSS pixel width. Scale multiplies it.
  const [containerWidth, setContainerWidth] = useState<number>(800);
  // Zoom factor relative to the measured container width. The page is
  // rendered at width = containerWidth * scale (see renderWidth below), so
  // scale = 1.0 means "fill the available width" — true fit-to-width on every
  // device. The ± buttons adjust from here.
  //
  // (Phase 9w fix: the previous initializer computed a fraction against a
  // 612px "natural width", but since scale multiplies the CONTAINER width,
  // that fraction rendered the page at ~55% of the screen — tiny and hard to
  // read on mobile. 1.0 is the correct fit-to-width default.)
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
  // Track which PDF page is currently FULLY RENDERED. react-pdf doesn't
  // synchronously update the text layer when `pageNumber` changes — it
  // unmounts the old page, renders the new canvas, then attaches the text
  // layer DOM. During that gap (50-800ms depending on page complexity), the
  // .react-pdf__Page__textContent element either doesn't exist yet or
  // belongs to the OLD page. Running our highlight matcher in that window
  // silently fails because it can't find the target paragraph text.
  //
  // The Page's `onRenderSuccess` callback fires after both the canvas AND
  // the text layer are mounted and populated, so it's our signal that
  // matching is safe to attempt. We store the page number that's actually
  // rendered (not the one we asked for) in state, and the highlight effect
  // below depends on it — meaning the effect re-fires when render completes,
  // not just when paragraph data changes.
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  const handlePageRenderSuccess = useCallback(() => {    setRenderedPage(page);
  }, [page]);

  // Voice-paragraph highlight. The flow:
  //   1. Voice broadcasts a new paragraph via `currentReadingParagraph`
  //   2. If the paragraph is on a different page, livePage auto-advances and
  //      react-pdf starts rendering the new page
  //   3. Once render completes, `renderedPage` updates (via onRenderSuccess)
  //   4. This effect fires with both the paragraph and the rendered page
  //      matching — we look up the paragraph text in the text layer and add
  //      `.voice-para-highlight` to the spans that cover that range
  //
  // We retain a small retry loop after the gating condition is satisfied
  // because the text-layer DOM is occasionally populated a frame or two
  // AFTER onRenderSuccess fires (race between react-pdf internals). 15
  // attempts at 150ms gives us a ~2.25s ceiling, which always exceeds the
  // observed worst case (~800ms for a 1200×1800px page).
  const lastHighlightedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentReadingParagraph) {
      // No paragraph data — clear any existing highlight
      document
        .querySelectorAll(".voice-para-highlight")
        .forEach((el) => el.classList.remove("voice-para-highlight"));
      lastHighlightedKeyRef.current = null;
      return;
    }
    // Don't even attempt highlighting if the rendered page doesn't match the
    // paragraph's target page — page transition is still in flight. Clear
    // and bail. The effect will re-fire when renderedPage catches up.
    if (renderedPage !== currentReadingParagraph.page) {      document
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
      if (!textLayer) {        return false;
      }
      // Clear previous
      textLayer
        .querySelectorAll(".voice-para-highlight")
        .forEach((el) => el.classList.remove("voice-para-highlight"));

      const spans = Array.from(
        textLayer.querySelectorAll("span"),
      ) as HTMLElement[];
      if (spans.length === 0) {        return false;
      }

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

      // Normalize the target paragraph the same way as our concat for robust
      // substring matching.
      const fullTarget = currentReadingParagraph.text
        .replace(/\s+/g, " ")
        .trim();
      if (fullTarget.length < 12) return false;

      // Try multiple START anchors — the opening words of two adjacent
      // paragraphs sometimes collide (especially with common openers like
      // "The", "When", "We"), so we keep a few fallbacks.
      const startCandidates: string[] = [];
      startCandidates.push(fullTarget.slice(0, Math.min(80, fullTarget.length)));
      if (fullTarget.length > 100) {
        const mid = Math.floor(fullTarget.length / 2);
        startCandidates.push(fullTarget.slice(mid - 30, mid + 30));
      }
      if (fullTarget.length > 24) {
        startCandidates.push(fullTarget.slice(0, 24));
      }

      const concatLower = concat.toLowerCase();
      let startIdx = -1;
      let startLen = 0;
      for (const cand of startCandidates) {
        const idx = concatLower.indexOf(cand.toLowerCase());
        if (idx !== -1) {
          startIdx = idx;
          startLen = cand.length;
          break;
        }
      }
      if (startIdx === -1) {        return false;
      }

      // Find the END of the paragraph in the text layer. Phase 9p strategy:
      //
      // 1. PREFERRED: if VoiceReader gave us nextText (first 60 chars of the
      //    next paragraph) AND it's on the same source page, search for it
      //    in concatLower AFTER the start match. The position where it lands
      //    is exactly where THIS paragraph ends. This dodges all the issues
      //    with trying to match the tail of the current paragraph (ligatures,
      //    hyphenation across lines, end-text shared with adjacent paragraphs,
      //    etc.) — we just need to find a unique-enough next-paragraph
      //    opener and we get a clean boundary.
      //
      // 2. LAST-ON-PAGE: if nextIsSamePage is false, this paragraph is the
      //    last on the rendered page — highlight extends to the end of the
      //    concat (everything after start = the rest of the page's text).
      //
      // 3. FALLBACK: if nextText isn't found (rare — e.g., next paragraph
      //    opens with text that doesn't render verbatim in the text layer),
      //    try multiple end-anchors from the current paragraph at decreasing
      //    lengths (60, 40, 25). The shorter the anchor the more likely it
      //    matches, with the tradeoff that it's less specific.
      //
      // 4. LAST RESORT: use 1.4× fullTarget.length as a permissive bound.
      //    The 1.4× factor accounts for the inter-span spaces we add to
      //    concat that aren't in fullTarget (so concat length > extracted
      //    length for the same visual paragraph).
      let highlightEnd: number = -1;
      const para = currentReadingParagraph;
      const endSearchFrom = startIdx + startLen;

      if (para.nextText && para.nextIsSamePage && para.nextText.length >= 20) {
        const nextLower = para.nextText.toLowerCase();
        const nextMatchIdx = concatLower.indexOf(nextLower, endSearchFrom);
        if (nextMatchIdx !== -1) {
          highlightEnd = nextMatchIdx; // stop right where next paragraph starts
        }
      } else if (!para.nextIsSamePage) {
        // Current is the last paragraph on this page — highlight to end.
        highlightEnd = concat.length;
      }

      if (highlightEnd === -1) {
        // Fallback: try end-anchors from the CURRENT paragraph at decreasing
        // lengths. The shorter ones are more permissive — match more often,
        // but less precise about exact end position.
        for (const endLen of [60, 40, 25]) {
          if (fullTarget.length < endLen + 12) continue;
          const cand = fullTarget.slice(-endLen).toLowerCase();
          if (cand === startCandidates[0].toLowerCase()) continue;
          const idx = concatLower.indexOf(cand, endSearchFrom);
          if (idx !== -1) {
            highlightEnd = idx + endLen;
            break;
          }
        }
      }

      if (highlightEnd === -1) {
        // Last resort — bound by extracted length with a permissive multiplier
        // for the inter-span spaces concat picks up. Not as tight as the
        // preferred path but better than a hard truncation.
        highlightEnd = startIdx + Math.floor(fullTarget.length * 1.4);
      }

      // Safety cap: with nextText we're naturally bounded, but the fallback
      // paths could in theory match late in the page. Cap at a generous
      // multiple of the extracted text length, with a high absolute ceiling
      // for legitimately long paragraphs (block quotes, Bible passages, legal
      // preambles). Phase 9p loosened this from 1.5× / 2500 → 3× / 5000 to
      // accommodate the inter-span space inflation in concat.
      const maxHighlightSpan = Math.min(
        Math.floor(fullTarget.length * 3),
        5000,
      );
      highlightEnd = Math.min(highlightEnd, startIdx + maxHighlightSpan);

      let highlightedCount = 0;
      for (const r of ranges) {
        if (r.end > startIdx && r.start < highlightEnd) {
          r.el.classList.add("voice-para-highlight");
          highlightedCount++;
        }
      }      return true;
    };

    // First attempt — usually succeeds because renderedPage === paragraph.page
    if (apply()) {
      lastHighlightedKeyRef.current = key;
      return;
    }

    // Persistent retry. Text-layer DOM is occasionally populated 1-2 frames
    // after onRenderSuccess fires. Poll every 150ms for up to 15 attempts
    // (~2.25s). Almost always lands in 1-3 attempts.
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (apply()) {
        lastHighlightedKeyRef.current = key;
        clearInterval(interval);
      } else if (attempts >= 15) {
        clearInterval(interval);
      }
    }, 150);
    return () => clearInterval(interval);
  }, [currentReadingParagraph, renderedPage]);

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

  // ----- Highlighting & notes (Phase 9z) ---------------------------------
  // A selection in the PDF text layer becomes a `book_notes` highlight: the
  // quote, a colour, and NORMALISED rects (fractions of the page box, so they
  // redraw at any zoom). The chapter is auto-detected from the current page.
  const [selection, setSelection] = useState<{
    text: string;
    rect: DOMRect; // viewport rect of the whole selection — positions the toolbar
    rects: NoteRect[]; // per-line rects, normalised to the page box
  } | null>(null);
  const [composer, setComposer] = useState<{
    text: string;
    rects: NoteRect[];
    page: number;
  } | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  // Contextual tap menu over the page: remove a highlight, or start narration
  // from this page. Positioned at the tap point (viewport coords).
  const [tapMenu, setTapMenu] = useState<{
    x: number;
    y: number;
    note: Note | null;
  } | null>(null);

  // Live highlights for this book, so saved marks redraw on their pages.
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    return watchBookNotes(userId, bookId, setNotes);
  }, [userId, bookId]);

  const pageHighlights = useMemo(
    () =>
      notes.filter(
        (n) =>
          n.anchor.medium === "pdf" &&
          n.anchor.page === page &&
          !!n.anchor.rects &&
          n.anchor.rects.length > 0,
      ),
    [notes, page],
  );

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
      const pageEl = pageWrapperRef.current.querySelector(
        ".react-pdf__Page",
      ) as HTMLElement | null;
      if (!pageEl) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const pageRect = pageEl.getBoundingClientRect();
      const rects = normalizeSelectionRects(range, pageRect);
      setSelection({ text, rect: range.getBoundingClientRect(), rects });
    }
    document.addEventListener("selectionchange", handleSelection);
    return () =>
      document.removeEventListener("selectionchange", handleSelection);
  }, []);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  /** Persist a highlight note from a captured snapshot. */
  const saveHighlight = useCallback(
    async (
      color: string | null,
      body: string,
      snap: { text: string; rects: NoteRect[]; page: number },
    ) => {
      const ch = chapterForPageIndex(chapterMap, snap.page);
      try {
        await createNote(userId, bookId, {
          type: "highlight",
          quote: snap.text,
          color,
          body,
          anchor: {
            ...emptyAnchor("pdf"),
            chapter_index: ch.index,
            chapter_title: ch.title,
            page: snap.page,
            rects: snap.rects,
          },
        });
        setSavedToast(body ? "Note saved" : "Highlighted");
        setTimeout(() => setSavedToast(null), 1800);
      } catch (err) {
        console.error("[pdf] saveHighlight failed", err);
        setSavedToast("Couldn’t save — try again");
        setTimeout(() => setSavedToast(null), 2200);
      }
    },
    [userId, bookId, chapterMap],
  );

  /** Instant colour highlight (no commentary). */
  function highlightWith(color: string) {
    if (!selection) return;
    void saveHighlight(color, "", {
      text: selection.text,
      rects: selection.rects,
      page,
    });
    clearSelection();
  }

  /** Open the quick "add a thought" sheet for the current selection. */
  function openComposer() {
    if (!selection) return;
    setComposer({ text: selection.text, rects: selection.rects, page });
    clearSelection();
  }

  /**
   * Tap on the page (not a margin nav-zone, not during a selection): if it
   * landed on a saved highlight, offer to remove it; otherwise offer to start
   * narration from this page. Margin taps still fall through to onPageClick.
   */
  function handleContentTap(e: React.MouseEvent<HTMLDivElement>) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return; // selecting
    const pageEl = pageWrapperRef.current?.querySelector(
      ".react-pdf__Page",
    ) as HTMLElement | null;
    if (!pageEl) return;
    const pr = pageEl.getBoundingClientRect();
    const nx = (e.clientX - pr.left) / pr.width;
    const ny = (e.clientY - pr.top) / pr.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return; // outside the page box
    const hit = pageHighlights.find((n) =>
      (n.anchor.rects ?? []).some(
        (r) => nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h,
      ),
    );
    if (!hit && !onPlayFromPage) return; // nothing to offer
    setTapMenu({ x: e.clientX, y: e.clientY, note: hit ?? null });
  }

  async function removeHighlight(noteId: string) {
    setTapMenu(null);
    try {
      await deleteNote(noteId);
      setSavedToast("Highlight removed");
    } catch (err) {
      console.error("[pdf] removeHighlight failed", err);
      setSavedToast("Couldn’t remove — try again");
    }
    setTimeout(() => setSavedToast(null), 1800);
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
      {/* Auto-hiding toolbar.
       *
       * Mobile (≤640px): stacks the navigation group on top and the zoom +
       * fullscreen group underneath, right-aligned. The nav group also wraps
       * within itself so the audio mini-player and "Following voice" chip
       * drop to a second nav line on very narrow screens.
       *
       * Desktop (≥640px): single row, nav on the left, zoom/fullscreen on
       * the right — exactly as before. */}
      <div
        className={
          "sticky top-0 z-10 mb-3 flex w-full flex-col gap-2 border-b ml-hairline bg-parchment-50/95 px-3 py-2 backdrop-blur-sm transition-opacity sm:flex-row sm:items-center sm:justify-between sm:gap-3 " +
          (showToolbar ? "opacity-100" : "opacity-0 pointer-events-none")
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
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
              className="inline-flex items-center gap-1 rounded-full bg-forest-50 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-forest-700 sm:px-2.5"
              title="The voice reader is playing — the PDF is following along page-by-page"
            >
              <Headphones size={11} />
              {/* On mobile the chip is tight; hide the prose and show only
               * the page number. The icon + "pg N" still telegraphs "audio
               * is driving the page." */}
              <span className="hidden sm:inline">Following voice · </span>
              pg {currentReadingPage}
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

        <div className="flex items-center gap-1 self-end sm:self-auto">
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

      {/* Floating selection toolbar — colour swatches + add-note */}
      {selection && (
        <div
          className="fixed z-30"
          style={{
            top: Math.max(70, selection.rect.top - 50),
            left: Math.min(
              (typeof window !== "undefined" ? window.innerWidth : 360) - 224,
              Math.max(8, selection.rect.left + selection.rect.width / 2 - 108),
            ),
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1.5 rounded-full border border-ink-500/25 bg-parchment-50 px-2 py-1.5 shadow-paper-lg">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={`Highlight ${c.label}`}
                onClick={() => highlightWith(c.hex)}
                className="h-6 w-6 rounded-full border border-ink-900/10 transition-transform hover:scale-110"
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <span className="mx-0.5 h-5 w-px bg-ink-500/20" />
            <button
              type="button"
              aria-label="Add a note"
              onClick={openComposer}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-ink-800 hover:bg-parchment-100"
            >
              <PenLine size={13} className="text-oxblood-700" />
              Note
            </button>
          </div>
        </div>
      )}

      {savedToast && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-sm border border-forest-600/40 bg-forest-50 px-4 py-2 text-sm text-forest-600 shadow-paper-lg">
          <Check size={14} />
          {savedToast}
        </div>
      )}

      {composer && (
        <QuickNoteSheet
          snapshot={composer}
          onCancel={() => setComposer(null)}
          onSave={(color, body) => {
            void saveHighlight(color, body.trim(), composer);
            setComposer(null);
          }}
        />
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
          <div className="relative" onClick={handleContentTap}>
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
              onRenderSuccess={handlePageRenderSuccess}
            />
          </Document>
          {/* Saved-highlight overlay (Phase 9z). Percentage coords reconstruct
              the normalised rects exactly, at any zoom. pointer-events-none so
              it never blocks selection or the nav tap-zones. */}
          {renderedPage === page && pageHighlights.length > 0 && (
            <div className="pointer-events-none absolute inset-0">
              {pageHighlights.map((n) =>
                (n.anchor.rects ?? []).map((r, i) => (
                  <span
                    key={`${n.id}-${i}`}
                    className="absolute rounded-[1px]"
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                      backgroundColor: n.color ?? "#E8C766",
                      opacity: 0.4,
                      mixBlendMode: "multiply",
                    }}
                  />
                )),
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Contextual tap menu — remove a highlight, or play from this page */}
      {tapMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setTapMenu(null)}>
          <div
            className="absolute -translate-x-1/2 -translate-y-full rounded-md border ml-hairline bg-parchment-50 p-1 shadow-paper-lg"
            style={{ left: tapMenu.x, top: tapMenu.y - 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            {tapMenu.note ? (
              <button
                type="button"
                onClick={() => void removeHighlight(tapMenu.note!.id)}
                className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm text-oxblood-700 hover:bg-oxblood-50"
              >
                <Trash2 size={14} /> Remove highlight
              </button>
            ) : (
              onPlayFromPage && (
                <button
                  type="button"
                  onClick={() => {
                    onPlayFromPage(page);
                    setTapMenu(null);
                  }}
                  className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm text-ink-800 hover:bg-parchment-100"
                >
                  <Play size={14} /> Play from here
                </button>
              )
            )}
          </div>
        </div>
      )}

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
// QuickNoteSheet — bottom-sheet composer to attach a thought to a highlight
// ----------------------------------------------------------------------------

function QuickNoteSheet({
  snapshot,
  onSave,
  onCancel,
}: {
  snapshot: { text: string; rects: NoteRect[]; page: number };
  onSave: (color: string | null, body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [color, setColor] = useState<string>(HIGHLIGHT_COLORS[0].hex);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/30 backdrop-blur-[1px]"
      onClick={onCancel}
    >
      <div
        className="ml-card w-full max-w-xl rounded-b-none px-5 pb-6 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-500/25" />
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-oxblood-700">
          Add a note · page {snapshot.page}
        </p>
        <blockquote
          className="mt-2 max-h-24 overflow-auto border-l-2 pl-3 font-display text-sm italic leading-relaxed text-ink-800"
          style={{ borderColor: color }}
        >
          “{snapshot.text}”
        </blockquote>

        <div className="mt-3 flex items-center gap-2">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              aria-label={c.label}
              onClick={() => setColor(c.hex)}
              className={
                "h-6 w-6 rounded-full border transition-transform hover:scale-110 " +
                (color === c.hex ? "ring-2 ring-ink-700/40 ring-offset-1" : "")
              }
              style={{ backgroundColor: c.hex, borderColor: `${c.hex}AA` }}
            />
          ))}
        </div>

        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Your thought on this passage…"
          className="mt-3 w-full rounded-sm border border-ink-500/25 bg-parchment-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500/70 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700/20"
        />

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm border border-ink-500/30 px-4 py-2 text-sm text-ink-800 hover:bg-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(color, body)}
            className="inline-flex items-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-600 px-4 py-2 text-sm font-medium text-parchment-50 hover:bg-oxblood-700"
          >
            <PenLine size={13} />
            Save
          </button>
        </div>
      </div>
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
