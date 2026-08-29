"use client";

import { useEffect, useRef, useState } from "react";
import type { Room } from "@/lib/taxonomy";
import { GeneratedCover } from "./GeneratedCover";

interface BookCoverProps {
  url: string | null | undefined;
  alt: string;
  /** Title/authors/room drive the drawn cover shown when there's no art
   * (or while art is still loading). Without a title we fall back to a plain
   * parchment panel. */
  title?: string;
  authors?: string[];
  room?: Room;
  /** "grid" requests a smaller source image for shelf cards; "hero" keeps the
   * full-size one for book-detail. Default "grid" — most covers on screen at
   * any moment are small. */
  variant?: "grid" | "hero";
  /** Above-the-fold covers load eagerly at high priority; everything else
   * stays lazy. Default false. */
  priority?: boolean;
  /** Optional tweak when the cover img loads OK — applied to <img> only,
   * NOT the drawn cover beneath. Used for hover-scale transitions etc. */
  imgClassName?: string;
}

/**
 * Two OpenLibrary-specific adjustments:
 *
 * 1. It serves the same cover at -S/-M/-L. Stored cover_url values are all -L
 *    (that's what the ISBN lookup writes), far more pixels than a ~200px-wide
 *    shelf card can use. Grid cards get -M; the book-detail hero keeps -L.
 *
 * 2. By default a miss returns a blank placeholder image with HTTP 200 rather
 *    than a 404, so onError never fires and the card shows an empty grey box.
 *    `default=false` makes misses 404 properly, which lets the drawn cover
 *    underneath stand as the real fallback.
 *
 * Anything that isn't an OpenLibrary cover URL is returned untouched.
 */
function normalizeCoverUrl(url: string, variant: "grid" | "hero"): string {
  if (!url.includes("covers.openlibrary.org")) return url;

  let out = variant === "grid" ? url.replace(/-L\.jpg/, "-M.jpg") : url;
  if (!/[?&]default=/.test(out)) {
    out += (out.includes("?") ? "&" : "?") + "default=false";
  }
  return out;
}

/**
 * Cover image with a drawn cover permanently underneath it.
 *
 * The earlier version branched between <img> and a BookOpen icon, which left
 * three visibly broken states: books with no cover_url at all (7 of 44 — five
 * of them small-press titles with no art on OpenLibrary or Google Books to
 * fetch, two with no ISBN to look one up with), books whose URL 404s, and —
 * most commonly — the gap while a lazy remote image was still in flight,
 * which rendered as an empty beige rectangle.
 *
 * Now GeneratedCover is always painted first and the remote image fades in on
 * top of it once decoded. A missing, slow, or dead URL simply leaves the drawn
 * cover in place, so a card is never blank at any point.
 */
export function BookCover({
  url,
  alt,
  title,
  authors,
  room,
  variant = "grid",
  priority = false,
  imgClassName,
}: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const showImg = !!url && !failed;

  /**
   * A cached image can finish loading before React hydrates this component,
   * in which case neither onLoad nor onError ever fires and the cover would
   * sit at opacity-0 forever. Reconcile against the element's actual state on
   * mount: complete + non-zero intrinsic width means it decoded fine,
   * complete + zero width means it errored.
   */
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) setLoaded(true);
    else setFailed(true);
  }, [url, variant]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-parchment-200">
      {title ? (
        <GeneratedCover title={title} authors={authors} room={room} />
      ) : (
        <div className="h-full w-full bg-parchment-200" />
      )}

      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={normalizeCoverUrl(url as string, variant)}
          alt={alt}
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          // fetchpriority is valid HTML; React's types don't include it yet.
          {...({ fetchpriority: priority ? "high" : "auto" } as Record<
            string,
            string
          >)}
          className={
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500 " +
            (loaded ? "opacity-100 " : "opacity-0 ") +
            (imgClassName ?? "")
          }
        />
      )}
    </div>
  );
}
