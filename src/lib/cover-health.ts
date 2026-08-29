"use client";

import { normalizeCoverUrl } from "./cover-url";

/**
 * Minimum intrinsic width for a cover to count as real artwork.
 *
 * OpenLibrary answers a miss with a 43-byte 1x1 GIF and HTTP 200 unless
 * `default=false` is set, and other hosts have similar habits. Anything this
 * small is a placeholder, not a cover — treat it as absent so the drawn
 * cover takes over.
 */
const MIN_USABLE_WIDTH = 60;

const PROBE_TIMEOUT_MS = 12_000;

/**
 * Does this cover URL actually resolve to usable artwork?
 *
 * Probes with an Image rather than fetch(), because image loads aren't
 * subject to CORS — a fetch to covers.openlibrary.org from the browser would
 * be blocked and tell us nothing.
 *
 * Never rejects: an unreachable or malformed URL is simply "not usable".
 */
export function isCoverUsable(
  url: string | null | undefined,
): Promise<boolean> {
  if (!url) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const img = new Image();
    let settled = false;

    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => settle(false), PROBE_TIMEOUT_MS);

    img.onload = () => settle(img.naturalWidth >= MIN_USABLE_WIDTH);
    img.onerror = () => settle(false);
    img.src = normalizeCoverUrl(url, "grid");
  });
}

/**
 * Probe many covers at once, returning the set of ids whose art is unusable.
 * Runs in small batches so a 45-book catalogue doesn't open 45 simultaneous
 * connections and stall the page.
 */
export async function findUnusableCovers(
  items: Array<{ id: string; coverUrl?: string | null }>,
  batchSize = 6,
): Promise<Set<string>> {
  const dead = new Set<string>();

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (it) => ({
        id: it.id,
        ok: await isCoverUsable(it.coverUrl),
      })),
    );
    for (const r of results) if (!r.ok) dead.add(r.id);
  }

  return dead;
}
