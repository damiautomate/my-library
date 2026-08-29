/**
 * Cover URL normalisation, shared by the renderer and the health check so
 * both judge a URL the same way. Isolated from BookCover because the admin
 * backfill needs it too, and a second copy would inevitably drift.
 */

/**
 * Two OpenLibrary-specific adjustments:
 *
 * 1. It serves the same cover at -S/-M/-L. Stored cover_url values are all -L
 *    (that's what the ISBN lookup writes), far more pixels than a ~200px-wide
 *    shelf card can use. Grid cards get -M; the book-detail hero keeps -L.
 *
 * 2. By default a miss returns a blank 1x1 placeholder with HTTP 200 rather
 *    than a 404, so onError never fires and the card shows an empty box.
 *    `default=false` makes misses 404 properly, which lets the drawn cover
 *    underneath stand as the real fallback.
 *
 * Anything that isn't an OpenLibrary cover URL is returned untouched.
 */
export function normalizeCoverUrl(
  url: string,
  variant: "grid" | "hero" = "grid",
): string {
  if (!url.includes("covers.openlibrary.org")) return url;

  let out = variant === "grid" ? url.replace(/-L\.jpg/, "-M.jpg") : url;
  if (!/[?&]default=/.test(out)) {
    out += (out.includes("?") ? "&" : "?") + "default=false";
  }
  return out;
}
