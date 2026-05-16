"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactReader, type IReactReaderProps } from "react-reader";
import type { Rendition, Book as EpubBook } from "epubjs";
import { makeDebouncedSaver } from "@/lib/progress";

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
    </div>
  );
}
