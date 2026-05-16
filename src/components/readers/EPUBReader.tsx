"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactReader, type IReactReaderProps } from "react-reader";
import type { Rendition, Book as EpubBook } from "epubjs";
import { Highlighter } from "lucide-react";
import { addHighlight, makeDebouncedSaver } from "@/lib/progress";

interface EPUBReaderProps {
  url: string;
  userId: string;
  bookId: string;
  /** Initial EPUB CFI to restore. */
  initialCfi?: string;
  onPercentChange?: (pct: number) => void;
}

export function EPUBReader({
  url,
  userId,
  bookId,
  initialCfi,
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

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1500),
    [userId, bookId],
  );

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

  const getRendition: IReactReaderProps["getRendition"] = (rendition) => {
    renditionRef.current = rendition;
    const book = rendition.book;
    epubBookRef.current = book;

    // Match the library's typography
    rendition.themes.register("library", {
      body: {
        "font-family": "'IBM Plex Sans', system-ui, sans-serif",
        color: "#1A1410",
        "line-height": "1.65",
      },
      "p, li": { "font-size": "1.05rem" },
    });
    rendition.themes.select("library");

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

  return (
    <div className="relative h-[calc(100vh-180px)] w-full overflow-hidden rounded-sm border ml-hairline bg-parchment-50 shadow-paper-lg">
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
  );
}
