"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";

interface BookCoverProps {
  url: string | null | undefined;
  alt: string;
  /** Size of the BookOpen icon fallback. Default 40 (good for shelf cards);
   * use ~56 on book-detail hero covers. */
  fallbackSize?: number;
  /** Optional tweak when the cover img loads OK — applied to <img> only,
   * NOT the fallback wrapper. Used for hover-scale transitions etc. */
  imgClassName?: string;
}

/**
 * Cover image with safe broken-URL fallback (Phase 9r).
 *
 * Reality of the catalog: many cover_url values are Google Books thumbnails,
 * Cloudinary URLs that occasionally 403, or third-party hotlinks that expire.
 * The pre-9r render path used a naive `cover_url ? <img/> : <fallback/>`
 * branch, which meant a broken URL kept rendering an EMPTY img element —
 * no image, no fallback, just blank space. This component watches the img's
 * onError event and swaps to the BookOpen icon when the actual fetch fails,
 * so a dead URL still produces a sensible-looking card.
 *
 * Wraps an aspect-[2/3] parent — callers are responsible for the outer
 * container shape; this component only fills it.
 */
export function BookCover({
  url,
  alt,
  fallbackSize = 40,
  imgClassName,
}: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const showImg = !!url && !failed;
  if (!showImg) {
    return (
      <div className="flex h-full w-full items-center justify-center text-ink-500/40">
        <BookOpen size={fallbackSize} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      onError={() => setFailed(true)}
      loading="lazy"
      className={
        "h-full w-full object-cover " +
        (imgClassName ?? "")
      }
    />
  );
}
