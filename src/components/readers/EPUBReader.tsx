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
  /** Page currently being narrated by voice. While voice is playing on
   * another tab and the user has this EPUB tab open, paragraphs matching this
   * source page get highlighted to follow along. */
  currentReadingPage?: number | null;
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
  // tells us which chapter contains that PDF page, navigate there. We only do
  // this on changes — not on initial mount — to avoid overriding initialCfi.
  const lastNavigatedPage = useRef<number | null>(null);
  // Track current highlight target in a ref so the "rendered" event handler
  // (set up once at mount) can read the latest value without re-binding.
  const currentHighlightPageRef = useRef<number | null>(null);
  useEffect(() => {
    currentHighlightPageRef.current = currentReadingPage ?? null;
  }, [currentReadingPage]);
  useEffect(() => {
    if (externalPage == null) return;
    if (!chapterMap || chapterMap.length === 0) return;
    if (!renditionRef.current) return;
    if (lastNavigatedPage.current === externalPage) return;

    // Find the chapter with the greatest source_page_start <= externalPage
    let target: EpubChapterMapping | null = null;
    for (const c of chapterMap) {
      if (c.source_page_start <= externalPage) target = c;
      else break;
    }
    if (target) {
      lastNavigatedPage.current = externalPage;
      try {
        renditionRef.current.display(target.href);
      } catch (err) {
        console.warn("[epub] chapter navigation failed", err);
      }
    }
  }, [externalPage, chapterMap]);

  // Apply paragraph-level highlighting when currentReadingPage changes. We
  // walk the rendered iframe content and toggle .voice-highlight on every
  // <p data-source-page="N"> matching the page being narrated. The CSS for
  // .voice-highlight is registered in the theme above.
  useEffect(() => {
    if (currentReadingPage == null) return;
    if (!renditionRef.current) return;
    try {
      const contents = renditionRef.current.getContents() as unknown as Array<{
        document: Document;
      }>;
      for (const c of contents) {
        if (!c || !c.document) continue;
        // Clear previous
        c.document
          .querySelectorAll(".voice-highlight")
          .forEach((el) => el.classList.remove("voice-highlight"));
        // Apply new
        c.document
          .querySelectorAll(`[data-source-page="${currentReadingPage}"]`)
          .forEach((el) => el.classList.add("voice-highlight"));
      }
    } catch (err) {
      // Iframe might not be ready yet — safe to ignore
      console.warn("[epub] highlight update failed", err);
    }
  }, [currentReadingPage]);

  const getRendition: IReactReaderProps["getRendition"] = (rendition) => {
    renditionRef.current = rendition;
    const book = rendition.book;
    epubBookRef.current = book;

    // Match the library's typography
    rendition.themes.register("library", {
      body: {
        "font-family": "'IBM Plex Sans', system-ui, sans-serif",
        color: "#1A1410",
        "line-height": "1.5",
        // CRITICAL on mobile: turn off justification which spreads words and
        // wastes horizontal space. left-aligned packs more text per line.
        "text-align": "left !important",
        // Tighter content padding so the iframe shows more text
        padding: "0 !important",
        margin: "0 !important",
      },
      "p, li": {
        "font-size": "1rem",
        margin: "0 0 0.6em 0",
        "text-align": "left !important",
      },
      h1: { "font-size": "1.5rem", "margin-top": "1rem" },
      h2: { "font-size": "1.25rem" },
      h3: { "font-size": "1.05rem" },
      blockquote: {
        "border-left": "2px solid rgba(123,45,38,0.4)",
        "padding-left": "0.75rem",
        margin: "1em 0",
        "font-style": "italic",
      },
      // The .voice-highlight class is toggled on/off via DOM manipulation
      // each time the currently-narrated page changes. CSS lives here so it
      // gets applied to the iframe content automatically by epub.js.
      ".voice-highlight": {
        "background-color": "rgba(201, 169, 97, 0.28) !important",
        "border-left": "3px solid #C9A961 !important",
        "padding": "0.2em 0.4em !important",
        "margin-left": "-0.6em !important",
        "transition": "background-color 0.3s ease !important",
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
      try {
        const nav = book.navigation;
        if (nav && section.href) {
          const item = nav.get(section.href);
          if (item?.label) setChapterTitle(item.label.trim());
        }
      } catch {}
      // Re-apply highlight after a small delay to let the iframe finish loading
      if (currentHighlightPageRef.current != null) {
        const page = currentHighlightPageRef.current;
        setTimeout(() => {
          try {
            const contents = rendition.getContents() as unknown as Array<{
              document: Document;
            }>;
            for (const c of contents) {
              if (!c || !c.document) continue;
              c.document
                .querySelectorAll(".voice-highlight")
                .forEach((el) => el.classList.remove("voice-highlight"));
              c.document
                .querySelectorAll(`[data-source-page="${page}"]`)
                .forEach((el) => el.classList.add("voice-highlight"));
            }
          } catch {}
        }, 100);
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
