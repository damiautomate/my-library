"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactReader, type IReactReaderProps } from "react-reader";
import type { Rendition, Book as EpubBook } from "epubjs";
import { Highlighter, Type, ChevronLeft, ChevronRight } from "lucide-react";
import { addHighlight, makeDebouncedSaver } from "@/lib/progress";

import type { EpubChapterMapping } from "@/lib/types";

interface EPUBReaderProps {
  url: string;
  userId: string;
  bookId: string;
  /** Initial EPUB CFI to restore. */
  initialCfi?: string;
  /** Map of EPUB chapters to PDF source pages, from the convert pipeline. */
  chapterMap?: EpubChapterMapping[];
  /** Page set externally (PDF/Voice readers). When this changes AND this
   * reader isn't currently focused, navigate to the matching chapter. */
  externalPage?: number | null;
  /** Page currently being narrated by voice (fallback for older voice
   * generations that don't have paragraph data). When set, ALL paragraphs
   * on this page get a soft highlight. */
  currentReadingPage?: number | null;
  /** Single-paragraph target currently being narrated. When set, ONLY the
   * matching paragraph gets the highlight — much cleaner UX than the
   * whole-page fallback. Requires the voice segment to have pages_paragraphs
   * (generated after Phase 9e). */
  currentReadingParagraph?: {
    page: number;
    paragraphIndex: number;
  } | null;
  onPercentChange?: (pct: number) => void;
}

export function EPUBReader({
  url,
  userId,
  bookId,
  initialCfi,
  chapterMap,
  externalPage,
  currentReadingPage,
  currentReadingParagraph,
  onPercentChange,
}: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(initialCfi ?? 0);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const locationsReady = useRef(false);
  const [pct, setPct] = useState<number | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    cfi: string;
    text: string;
  } | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  // Default font: 95% on desktop, 85% on mobile (narrow viewport = less
  // horizontal room, smaller font = more lines fit on screen)
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return 85;
    return 95;
  });
  const [chapterTitle, setChapterTitle] = useState<string>("");
  // Flips true on the first "rendered" event. Used as a highlight-effect
  // dependency so that if audio is already mid-paragraph when the EPUB mounts
  // (e.g. user switches to the EPUB tab while listening), the highlight runs
  // as soon as the iframe content exists — not only on the next paragraph.
  const [renditionReady, setRenditionReady] = useState(0);

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1500),
    [userId, bookId],
  );

  // Re-apply theme whenever the font size changes
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    try {
      r.themes.fontSize(`${fontSize}%`);
    } catch {}
  }, [fontSize]);

  // Save on every relocation event + compute percent once locations are built
  function handleLocationChanged(cfi: string) {
    setLocation(cfi);

    let percent: number | undefined = undefined;
    const book = epubBookRef.current;
    if (book && locationsReady.current) {
      try {
        const p = book.locations.percentageFromCfi(cfi);
        if (typeof p === "number" && !Number.isNaN(p)) {
          percent = Math.round(p * 100);
          setPct(percent);
          onPercentChange?.(percent);
        }
      } catch {
        // locations not yet usable — ignore
      }
    }

    saver.save({ current_cfi: cfi, current_percent: percent });
  }

  // Every 10 seconds, push latest position (spec §16)
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof location === "string") {
        const book = epubBookRef.current;
        let percent: number | undefined = undefined;
        if (book && locationsReady.current) {
          try {
            const p = book.locations.percentageFromCfi(location);
            if (typeof p === "number" && !Number.isNaN(p)) {
              percent = Math.round(p * 100);
            }
          } catch {}
        }
        saver.save({ current_cfi: location, current_percent: percent });
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [location, saver]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      void saver.flush();
    };
  }, [saver]);

  // External-page → chapter navigation. When the user is on another tab (PDF
  // or Voice) and advances pages there, externalPage changes. If chapterMap
  // tells us which chapter contains that PDF page, navigate there — but ONLY
  // when the resolved chapter actually changes, not on every page turn.
  //
  // Why the dedupe matters: voice playback advances externalPage page-by-page
  // within a chapter. If we re-displayed the chapter href on every page, the
  // reader would snap back to the chapter's first page each time, then
  // pageFollow would flip forward to the narrated paragraph — a visible
  // back-and-forth jitter. Tracking the last navigated chapter href means we
  // only load a new section when the reader genuinely crosses into it; the
  // within-chapter page flipping is left entirely to pageFollow.
  const lastNavigatedHref = useRef<string | null>(null);
  // Track current highlight target in refs so the "rendered" event handler
  // (set up once at mount) can read the latest values without re-binding.
  const currentHighlightPageRef = useRef<number | null>(null);
  const currentHighlightParagraphRef = useRef<{
    page: number;
    paragraphIndex: number;
  } | null>(null);
  useEffect(() => {
    currentHighlightPageRef.current = currentReadingPage ?? null;
  }, [currentReadingPage]);
  useEffect(() => {
    currentHighlightParagraphRef.current = currentReadingParagraph ?? null;
  }, [currentReadingParagraph]);
  useEffect(() => {
    if (externalPage == null) return;
    if (!chapterMap || chapterMap.length === 0) return;
    if (!renditionRef.current) return;

    // Find the chapter with the greatest source_page_start <= externalPage
    let target: EpubChapterMapping | null = null;
    for (const c of chapterMap) {
      if (c.source_page_start <= externalPage) target = c;
      else break;
    }
    if (target && lastNavigatedHref.current !== target.href) {
      lastNavigatedHref.current = target.href;
      try {
        renditionRef.current.display(target.href);
      } catch (err) {
        console.warn("[epub] chapter navigation failed", err);
      }
    }
  }, [externalPage, chapterMap]);

  // Follow the audio in PAGINATED mode by flipping to the page that contains
  // the just-highlighted paragraph — the EPUB analogue of the PDF advancing
  // pages. We only navigate when the element is NOT already on the visible
  // page, so consecutive paragraphs on the same page don't cause a re-flip
  // on every timeupdate (which would feel jittery and fight the reader).
  //
  // Visibility in a column layout: the current page occupies x in
  // [0, innerWidth). Content on the next page sits at x >= innerWidth; content
  // already read sits at x <= 0. So the element is on-screen iff its box
  // overlaps [0, innerWidth).
  function pageFollow(
    el: Element,
    contents: { window: Window; cfiFromNode?: (n: Node) => string },
  ) {
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const w = contents.window.innerWidth || 0;
      const onCurrentPage = rect.right > 2 && rect.left < w - 2;
      if (onCurrentPage) return; // already visible — don't disturb the page
      // Build a CFI for the element and navigate to it. display() within the
      // same chapter just shifts the column offset (no DOM rebuild), so the
      // highlight class we set stays put.
      const cfi = contents.cfiFromNode?.(el);
      if (cfi) void rendition.display(cfi);
    } catch {
      /* iframe not ready / CFI failure — ignore, highlight still applied */
    }
  }
  useEffect(() => {
    if (!renditionRef.current) return;
    if (currentReadingPage == null && !currentReadingParagraph) return;
    try {
      const contents = renditionRef.current.getContents() as unknown as Array<{
        document: Document;
        window: Window;
        cfiFromNode?: (n: Node) => string;
      }>;
      let matched = false;
      let anchorCount = 0;
      for (const c of contents) {
        if (!c || !c.document) continue;
        anchorCount += c.document.querySelectorAll("[data-source-page]").length;
        // Always clear previous highlights first
        c.document
          .querySelectorAll(".voice-highlight")
          .forEach((el) => el.classList.remove("voice-highlight"));
        // Apply new — paragraph-level if we have it
        if (currentReadingParagraph) {
          const selector = `[data-source-page="${currentReadingParagraph.page}"][data-page-paragraph-index="${currentReadingParagraph.paragraphIndex}"]`;
          const matches = c.document.querySelectorAll(selector);
          if (matches.length > 0) {
            matches.forEach((el) => el.classList.add("voice-highlight"));
            pageFollow(matches[0], c);
            matched = true;
            continue;
          }
        }
        if (currentReadingPage != null) {
          const pageMatches = c.document.querySelectorAll(
            `[data-source-page="${currentReadingPage}"]`,
          );
          if (pageMatches.length > 0) {
            pageMatches.forEach((el) => el.classList.add("voice-highlight"));
            pageFollow(pageMatches[0], c);
            matched = true;
          }
        }
      }
      // Diagnostic (9w): if we have a narration target but found no match,
      // report what the rendered content actually contains. anchorCount === 0
      // means this EPUB has no page anchors at all → it predates the current
      // converter and needs a Re-convert. anchorCount > 0 but no match means
      // the narrated page isn't in the currently-rendered chapter yet.
      if (!matched) {
        console.warn(
          `[epub-sync] no highlight match. narratedPage=${currentReadingPage} para=${
            currentReadingParagraph
              ? `${currentReadingParagraph.page}/${currentReadingParagraph.paragraphIndex}`
              : "none"
          } anchorsInView=${anchorCount}` +
            (anchorCount === 0
              ? " → this EPUB has no page anchors; Re-convert the book."
              : " → narrated page not in the rendered chapter yet."),
        );
      }
    } catch (err) {
      console.warn("[epub] highlight update failed", err);
    }
  }, [currentReadingPage, currentReadingParagraph, renditionReady]);

  const getRendition: IReactReaderProps["getRendition"] = (rendition) => {
    renditionRef.current = rendition;
    const book = rendition.book;
    epubBookRef.current = book;

    // Match the library's typography. This theme drives the IN-APP render
    // (the bundled styles.css only applies in external readers). Keep the two
    // visually aligned: justified body with a first-line indent, headings set
    // apart, no indent on the paragraph following a heading.
    rendition.themes.register("library", {
      body: {
        "font-family":
          "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
        color: "#1A1410",
        "line-height": "1.62",
        padding: "0 0.25rem !important",
        margin: "0 !important",
      },
      p: {
        "font-size": "1rem",
        margin: "0",
        "text-indent": "1.3em",
        "text-align": "justify",
        hyphens: "auto",
        "-webkit-hyphens": "auto",
      },
      // First paragraph & paragraphs right after a heading: no indent.
      "h1 + p, h2 + p, h3 + p, .chapter-title + p, p:first-of-type": {
        "text-indent": "0",
      },
      "p + p": { "margin-top": "0.15em" },
      li: { "font-size": "1rem", "text-align": "left" },
      h1: { "font-size": "1.5rem", "margin-top": "1rem", "line-height": "1.25" },
      h2: {
        "font-size": "1.28rem",
        "font-weight": "700",
        margin: "1.5em 0 0.5em 0",
        "line-height": "1.25",
      },
      h3: {
        "font-size": "1.06rem",
        "font-weight": "600",
        "font-style": "italic",
        margin: "1.25em 0 0.35em 0",
      },
      ".chapter-title": {
        "text-align": "center !important",
        "text-indent": "0 !important",
        margin: "1em 0 1.2em 0",
      },
      blockquote: {
        "border-left": "2px solid rgba(123,45,38,0.4)",
        "padding-left": "0.75rem",
        margin: "1em 0",
        "font-style": "italic",
      },
      "blockquote p": { "text-indent": "0", "text-align": "left" },
      // The .voice-highlight class is toggled via DOM manipulation each time
      // the narrated paragraph changes. scroll-margin keeps scrollIntoView
      // from jamming the highlighted line against the very top/bottom edge.
      ".voice-highlight": {
        "background-color": "rgba(201, 169, 97, 0.28) !important",
        "border-left": "3px solid #C9A961 !important",
        padding: "0.2em 0.4em !important",
        "margin-left": "-0.6em !important",
        "text-indent": "0 !important",
        "scroll-margin-top": "40vh !important",
        "scroll-margin-bottom": "40vh !important",
        transition: "background-color 0.3s ease !important",
      },
    });
    rendition.themes.select("library");
    rendition.themes.fontSize(`${fontSize}%`);

    // Capture selections inside the iframe — react-reader's epub.js exposes
    // a "selected" event with (cfiRange, contents). We surface a "Save
    // highlight" prompt in the parent UI rather than mutating the iframe.
    rendition.on("selected", (cfiRange: string, contents: { window: Window }) => {
      try {
        const sel = contents.window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (text.length < 2) return;
        setPendingSelection({ cfi: cfiRange, text });
      } catch (err) {
        console.warn("[epub] selection capture failed", err);
      }
    });

    // Track current chapter from the spine, AND re-apply voice highlight
    // since each render swaps out the iframe contents (clearing prior classes)
    rendition.on("rendered", (section: { href?: string }) => {
      // Signal the highlight effect that content is now available to query.
      setRenditionReady((n) => n + 1);
      try {
        const nav = book.navigation;
        if (nav && section.href) {
          const item = nav.get(section.href);
          if (item?.label) setChapterTitle(item.label.trim());
        }
      } catch {}
      // Re-apply highlight after a small delay to let the iframe finish loading
      const paragraphTarget = currentHighlightParagraphRef.current;
      const pageTarget = currentHighlightPageRef.current;
      if (paragraphTarget || pageTarget != null) {
        setTimeout(() => {
          try {
            const contents = rendition.getContents() as unknown as Array<{
              document: Document;
              window: Window;
              cfiFromNode?: (n: Node) => string;
            }>;
            for (const c of contents) {
              if (!c || !c.document) continue;
              c.document
                .querySelectorAll(".voice-highlight")
                .forEach((el) => el.classList.remove("voice-highlight"));
              if (paragraphTarget) {
                const sel = `[data-source-page="${paragraphTarget.page}"][data-page-paragraph-index="${paragraphTarget.paragraphIndex}"]`;
                const matches = c.document.querySelectorAll(sel);
                if (matches.length > 0) {
                  matches.forEach((el) => el.classList.add("voice-highlight"));
                  pageFollow(matches[0], c);
                  continue;
                }
              }
              if (pageTarget != null) {
                const pm = c.document.querySelectorAll(
                  `[data-source-page="${pageTarget}"]`,
                );
                pm.forEach((el) => el.classList.add("voice-highlight"));
                if (pm.length > 0) pageFollow(pm[0], c);
              }
            }
          } catch {}
        }, 120);
      }
    });

    // Generate per-character locations so we can compute percent.
    // 1024 = generate one location per ~1024 chars; reasonable balance.
    book.ready
      .then(() => book.locations.generate(1024))
      .then(() => {
        locationsReady.current = true;
        // Re-emit percent for current location
        if (typeof location === "string") {
          try {
            const p = book.locations.percentageFromCfi(location);
            if (typeof p === "number" && !Number.isNaN(p)) {
              const pp = Math.round(p * 100);
              setPct(pp);
              onPercentChange?.(pp);
            }
          } catch {}
        }
      })
      .catch(() => {
        // Locations failed — non-fatal, we just skip percent tracking
      });
  };

  async function captureHighlight() {
    if (!pendingSelection) return;
    try {
      await addHighlight(userId, bookId, {
        cfi: pendingSelection.cfi,
        text: pendingSelection.text,
        color: "yellow",
      });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
      // Clear iframe selection. epubjs's types declare getContents() as
      // singular but it actually returns an array at runtime; cast through
      // unknown to satisfy TS.
      try {
        const contents = renditionRef.current?.getContents();
        const arr = (Array.isArray(contents) ? contents : [contents]) as Array<{
          window: Window;
        }>;
        for (const c of arr) {
          c?.window?.getSelection()?.removeAllRanges();
        }
      } catch {}
      setPendingSelection(null);
    } catch (err) {
      console.error("[epub] saveHighlight failed", err);
    }
  }

  const goPrev = useCallback(() => {
    void renditionRef.current?.prev();
  }, []);
  const goNext = useCallback(() => {
    void renditionRef.current?.next();
  }, []);

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border ml-hairline bg-parchment-50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrev}
            className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100"
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
          {chapterTitle && (
            <span className="ml-2 max-w-xs truncate font-display text-sm text-ink-700">
              {chapterTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Type size={13} className="text-ink-500" />
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.max(70, f - 10))}
            className="rounded-sm px-2 py-1 font-mono text-[0.65rem] text-ink-700 hover:bg-parchment-100"
            aria-label="Smaller font"
          >
            A−
          </button>
          <span className="font-mono text-[0.65rem] text-ink-500">
            {fontSize}%
          </span>
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.min(180, f + 10))}
            className="rounded-sm px-2 py-1 font-mono text-[0.65rem] text-ink-700 hover:bg-parchment-100"
            aria-label="Larger font"
          >
            A+
          </button>
        </div>
      </div>

      <div className="epub-container relative h-[calc(100vh-220px)] min-h-[480px] w-full overflow-hidden rounded-sm border ml-hairline bg-parchment-50 shadow-paper-lg md:h-[calc(100vh-200px)]">
      <ReactReader
        url={url}
        location={location}
        locationChanged={handleLocationChanged}
        getRendition={getRendition}
        epubInitOptions={{ openAs: "epub" }}
      />
      {pct !== null && (
        <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-ink-900/70 px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-parchment-50">
          {pct}%
        </div>
      )}

      {/* Selection action — anchored to the top of the reader since we can't
          reliably get coords from inside the EPUB iframe across origins. */}
      {pendingSelection && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="pointer-events-auto inline-flex items-center gap-3 rounded-sm border border-gold-500 bg-parchment-50 px-3 py-2 text-sm shadow-paper-lg">
            <span className="max-w-[24rem] truncate font-display italic text-ink-700">
              “{pendingSelection.text}”
            </span>
            <button
              type="button"
              onClick={captureHighlight}
              className="inline-flex items-center gap-1.5 rounded-sm border border-gold-500 bg-parchment-100 px-2 py-1 text-xs hover:bg-parchment-200"
            >
              <Highlighter size={11} className="text-gold-600" />
              Save highlight
            </button>
            <button
              type="button"
              onClick={() => setPendingSelection(null)}
              className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500 hover:text-ink-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {savedToast && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-sm border border-forest-600/40 bg-forest-50 px-3 py-1.5 text-sm text-forest-600 shadow-paper-lg">
          ✓ Highlight saved
        </div>
      )}
      </div>
    </div>
  );
}
