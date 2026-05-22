"use client";

import { useRef, useState } from "react";
import { Loader2, BookOpenCheck, Headphones, CheckCircle2, X, AlertTriangle } from "lucide-react";
import { auth as firebaseAuth } from "@/lib/firebase/client";
import type { Book } from "@/lib/types";
import { NarratorPicker } from "./NarratorPicker";
import {
  getVoiceById,
  estimateCostUSD,
  formatChars,
  formatUSD,
  PRICE_PER_MILLION_CHARS_USD,
  FREE_QUOTA_CHARS_PER_MONTH,
} from "@/lib/voices";

interface Props {
  book: Book;
  onChanged?: () => void;
}

/**
 * Admin actions for derived assets: convert a PDF into an EPUB, and (next)
 * generate voice audio. Lives between the page header and the BookForm on the
 * edit page so it's prominent but not part of the form's save flow.
 */
export function ConversionActions({ book, onChanged }: Props) {
  const hasPdf = !!book.pdf_url;
  const hasEpub = !!book.epub_url;
  const hasVoice = Array.isArray(book.voice_segments) && book.voice_segments.length > 0;

  const [convertBusy, setConvertBusy] = useState(false);
  const [convertResult, setConvertResult] = useState<string | null>(null);
  const [convertErr, setConvertErr] = useState<string | null>(null);

  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResult, setVoiceResult] = useState<string | null>(null);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [voiceProgress, setVoiceProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const cancelVoiceRef = useRef(false);

  // Phase 9q.2 — billing-aware regen confirmation. When the user clicks
  // "Generate voice" or "Re-generate", we don't kick off synthesis directly;
  // instead we show an inline panel with the estimated character count and
  // USD cost so they can see what they're committing before any money is
  // spent. After Google billing was enabled in 9q.1, a careless regen can
  // burn $20+ on a 500-page book — this is the guard against accidental ones.
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  async function authHeader(): Promise<string> {
    const u = firebaseAuth.currentUser;
    if (!u) throw new Error("Not signed in");
    return `Bearer ${await u.getIdToken()}`;
  }

  async function convertPdfToEpub() {
    if (!confirm(
      hasEpub
        ? "This book already has an EPUB. Re-converting will replace it. Continue?"
        : "Convert this PDF to an EPUB? This can take 1-5 minutes for big books.",
    )) return;
    setConvertBusy(true);
    setConvertResult(null);
    setConvertErr(null);
    try {
      const res = await fetch(`/api/books/${book.id}/convert`, {
        method: "POST",
        headers: { Authorization: await authHeader() },
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const text = await res.text();
        throw new Error(
          `Server returned non-JSON (status ${res.status}). Likely a Vercel timeout. First 200 chars: ${text.slice(0, 200)}`,
        );
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Conversion failed");
      setConvertResult(
        `EPUB built — ${data.chapters} chapter${data.chapters === 1 ? "" : "s"} from ${data.pages_with_text}/${data.total_pages} pages${data.used_outline ? " using the PDF's outline" : " (no outline, chunked by pages)"}.`,
      );
      onChanged?.();
    } catch (err) {
      setConvertErr(err instanceof Error ? err.message : String(err));
    } finally {
      setConvertBusy(false);
    }
  }

  async function generateVoice() {
    const reset = hasVoice;
    // The native confirm() that used to live here was replaced by an inline
    // cost-aware confirmation panel (Phase 9q.2 — see the regen confirm
    // panel rendered below). By the time generateVoice() runs, the user has
    // already seen the estimated character count and USD cost and clicked
    // "Confirm and regenerate", so we proceed directly.
    setVoiceBusy(true);
    setVoiceResult(null);
    setVoiceErr(null);
    setVoiceProgress(null);
    cancelVoiceRef.current = false;

    let done = false;
    let totalChars = 0;
    let firstCall = true;
    // Per-segment retry counter. Vercel hobby tier 504s, network blips, and
    // transient Google TTS hiccups all warrant a quiet retry — the route is
    // idempotent on retry because nextIndex = existing.length, so the same
    // segment is re-attempted until it succeeds. We only surface a hard
    // error after MAX_RETRIES failures on the SAME segment.
    let retries = 0;
    const MAX_RETRIES = 3;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    while (!done) {
      if (cancelVoiceRef.current) {
        setVoiceErr("Stopped — partial segments saved on the book.");
        break;
      }

      let transientFailure: string | null = null;
      let fatalFailure: string | null = null;
      try {
        const res = await fetch(`/api/books/${book.id}/generate-voice`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: await authHeader(),
          },
          body: JSON.stringify({
            provider: "google",
            // Wipe existing segments only on the very first call after the
            // user confirmed a re-gen — subsequent calls are appends.
            reset: firstCall && reset,
          }),
        });

        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) {
          // Vercel returns plain-text "An error occurred..." on timeout.
          // 5xx without JSON is almost always a transient infra issue —
          // retry. Other statuses are unexpected — bail.
          const text = await res.text();
          if (res.status >= 500) {
            transientFailure = `Segment timeout (HTTP ${res.status})`;
          } else {
            fatalFailure = `Server returned non-JSON (status ${res.status}). First 200 chars: ${text.slice(0, 200)}`;
          }
        } else {
          const data = await res.json();
          if (!res.ok) {
            // 5xx with JSON error message — retry. 4xx is a client/auth
            // problem we can't recover from by retrying.
            if (res.status >= 500) {
              transientFailure = data.error ?? `Server error (${res.status})`;
            } else {
              fatalFailure = data.error ?? `Failed (status ${res.status})`;
            }
          } else {
            // SUCCESS — advance and reset retry counter
            firstCall = false;
            retries = 0;
            setVoiceProgress({ done: data.processed, total: data.total });
            if (data.segment) totalChars += data.segment.chars ?? 0;
            done = !!data.done;
            setVoiceErr(null);
            continue;
          }
        }
      } catch (err) {
        // Network errors, JSON parse errors, etc. — always retryable since
        // they're typically transient connectivity blips.
        transientFailure = err instanceof Error ? err.message : String(err);
      }

      // We got here via a failure. Decide retry vs bail.
      if (transientFailure && retries < MAX_RETRIES && !cancelVoiceRef.current) {
        retries++;
        const segNum = (voiceProgress?.done ?? 0) + 1;
        setVoiceErr(
          `Segment ${segNum} hit a snag (${transientFailure}). Retrying ${retries}/${MAX_RETRIES}…`,
        );
        // Mild backoff — first retry quick, later ones slower. The cache from
        // 9o means subsequent calls skip PDF extraction, so even the slow
        // ones tend to succeed on retry.
        await sleep(2000 * retries);
        continue;
      }

      // Out of retries, or a fatal error.
      const completed = voiceProgress?.done ?? 0;
      const segNum = completed + 1;
      const finalMsg =
        fatalFailure ??
        (transientFailure
          ? `Couldn't complete segment ${segNum} after ${MAX_RETRIES + 1} tries (${transientFailure}). ${completed} segments saved — click Re-generate to resume from segment ${segNum}.`
          : "Unknown error.");
      setVoiceErr(finalMsg);
      break;
    }

    if (done) {
      setVoiceResult(
        `Generation complete — ${voiceProgress?.total ?? "?"} segments, ${totalChars.toLocaleString()} characters synthesized.`,
      );
      onChanged?.();
    }
    setVoiceBusy(false);
  }

  function cancelVoice() {
    cancelVoiceRef.current = true;
  }

  // Nothing to show if there's no PDF — both actions need one as source
  if (!hasPdf) return null;

  return (
    <section className="mb-6 rounded-sm border border-ink-500/15 bg-parchment-100/60 p-4">
      <p className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
        Derived assets
      </p>

      {/* Convert to EPUB row */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b ml-hairline pb-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-base text-ink-900">
            EPUB
            {hasEpub && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle font-mono text-[0.6rem] uppercase tracking-[0.15em] text-forest-600">
                <CheckCircle2 size={11} />
                {book.epub_converted_from_pdf ? "Converted" : "Uploaded"}
              </span>
            )}
          </p>
          <p className="mt-1 max-w-xl text-xs text-ink-600">
            Convert the PDF into a reflowable EPUB so members can read in the
            EPUB tab — better on mobile and with text-size controls. Text-only
            (no images preserved); uses the PDF&apos;s outline for chapters when
            present.
          </p>
        </div>
        <button
          type="button"
          onClick={convertPdfToEpub}
          disabled={convertBusy}
          className="inline-flex items-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-50 px-3 py-1.5 text-xs text-oxblood-700 hover:bg-oxblood-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {convertBusy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <BookOpenCheck size={12} />
          )}
          {hasEpub ? "Re-convert" : "Convert to EPUB"}
        </button>
      </div>
      {convertResult && (
        <p className="mt-2 text-xs text-forest-600">✓ {convertResult}</p>
      )}
      {convertErr && (
        <p className="mt-2 text-xs text-oxblood-700">{convertErr}</p>
      )}

      {/* Narrator picker — sits between EPUB conversion and voice generation
       * so the user chooses WHO will read the book before clicking generate. */}
      <NarratorPicker
        book={book}
        hasVoice={hasVoice}
        onChanged={onChanged}
      />

      {/* Generate voice row */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-base text-ink-900">
            Voice audio
            {hasVoice && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle font-mono text-[0.6rem] uppercase tracking-[0.15em] text-forest-600">
                <CheckCircle2 size={11} />
                Generated
              </span>
            )}
          </p>
          <p className="mt-1 max-w-xl text-xs text-ink-600">
            Generate narration audio so members can listen to the book. Uses
            Google Cloud TTS in chunks of ~10 pages each, synced with the page
            position so switching between tabs preserves where you are.
          </p>
        </div>
        <button
          type="button"
          onClick={
            voiceBusy
              ? cancelVoice
              : () => {
                  // 9q.2 — show the cost-aware confirmation panel instead of
                  // running generateVoice immediately. The panel's confirm
                  // button is what actually kicks off synthesis.
                  setVoiceErr(null);
                  setVoiceResult(null);
                  setShowRegenConfirm(true);
                }
          }
          disabled={showRegenConfirm}
          className={
            "inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-xs disabled:opacity-50 " +
            (voiceBusy
              ? "border-oxblood-700 bg-oxblood-50 text-oxblood-700 hover:bg-oxblood-100"
              : "border-ink-500/30 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
          }
        >
          {voiceBusy ? (
            <>
              <X size={12} /> Stop
            </>
          ) : (
            <>
              <Headphones size={12} />
              {hasVoice ? "Re-generate" : "Generate voice"}
            </>
          )}
        </button>
      </div>

      {/* Cost-aware regen confirmation panel (9q.2). Estimates character
       * count from either the existing segments (precise) or page_count
       * (fallback), then multiplies by the voice's per-million-char rate. */}
      {showRegenConfirm && !voiceBusy && (
        <RegenConfirmPanel
          book={book}
          onCancel={() => setShowRegenConfirm(false)}
          onConfirm={() => {
            setShowRegenConfirm(false);
            void generateVoice();
          }}
        />
      )}
      {voiceProgress && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-600">
            <span>
              Segment {voiceProgress.done} of {voiceProgress.total}
            </span>
            <span>
              {voiceProgress.total > 0
                ? Math.round((voiceProgress.done / voiceProgress.total) * 100)
                : 0}
              %
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-parchment-200">
            <div
              className="h-full bg-oxblood-600 transition-all"
              style={{
                width: `${
                  voiceProgress.total > 0
                    ? Math.round((voiceProgress.done / voiceProgress.total) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          {voiceBusy && (
            <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
              Synthesizing next segment via Google TTS… keep this tab open.
            </p>
          )}
        </div>
      )}
      {voiceResult && (
        <p className="mt-2 text-xs text-forest-600">✓ {voiceResult}</p>
      )}
      {voiceErr && (
        <p className="mt-2 text-xs text-oxblood-700">{voiceErr}</p>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Regen confirmation panel — billing-aware (Phase 9q.2)
// ----------------------------------------------------------------------------

/**
 * Estimate the number of characters Google TTS will be asked to synthesize
 * for this book. Two paths, in order of accuracy:
 *
 *   1. If the book has existing voice_segments, sum their .chars — this is
 *      the EXACT count from the prior regen and is what a fresh re-gen with
 *      the same content will use again.
 *   2. Otherwise estimate from page_count × ~2,500 chars/page, which is a
 *      typical density for non-fiction body text. Returns 0 if page_count
 *      isn't set, in which case the modal shows "unknown".
 */
function estimateBookChars(book: Book): {
  chars: number;
  basis: "previous" | "pages" | "unknown";
} {
  const segs = book.voice_segments;
  if (Array.isArray(segs) && segs.length > 0) {
    const sum = segs.reduce((s, x) => s + (x.chars ?? 0), 0);
    if (sum > 0) return { chars: sum, basis: "previous" };
  }
  const pages = book.page_count ?? 0;
  if (pages > 0) return { chars: pages * 2500, basis: "pages" };
  return { chars: 0, basis: "unknown" };
}

interface RegenConfirmPanelProps {
  book: Book;
  onCancel: () => void;
  onConfirm: () => void;
}

function RegenConfirmPanel({
  book,
  onCancel,
  onConfirm,
}: RegenConfirmPanelProps) {
  const hasVoice =
    Array.isArray(book.voice_segments) && book.voice_segments.length > 0;
  const voice = getVoiceById(book.voice_id);
  const { chars, basis } = estimateBookChars(book);
  const cost = estimateCostUSD(chars, voice);
  const freeQuota = FREE_QUOTA_CHARS_PER_MONTH[voice.tier];
  const rate = PRICE_PER_MILLION_CHARS_USD[voice.tier];

  const basisLabel: Record<typeof basis, string> = {
    previous: "from the existing audio",
    pages: `~${book.page_count} pages × 2,500 chars/page`,
    unknown: "no page count on file — will be computed on the first call",
  };

  return (
    <div className="mt-3 rounded-sm border border-oxblood-200 bg-oxblood-50/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-oxblood-700">
          Confirm regeneration
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-ink-500 hover:text-ink-700"
          aria-label="Cancel"
        >
          <X size={13} />
        </button>
      </div>

      <dl className="space-y-1.5 text-xs text-ink-800">
        <ConfirmRow label="Narrator">
          <span className="font-display text-sm text-ink-900">
            {voice.displayName}
          </span>{" "}
          <span className="text-ink-500">
            ({voice.id} — {voice.tier})
          </span>
        </ConfirmRow>
        <ConfirmRow label="Estimated content">
          {chars > 0 ? (
            <>
              ~{formatChars(chars)} characters{" "}
              <span className="text-ink-500">({basisLabel[basis]})</span>
            </>
          ) : (
            <span className="text-ink-500">{basisLabel[basis]}</span>
          )}
        </ConfirmRow>
        <ConfirmRow label="Estimated cost">
          {chars > 0 ? (
            <>
              <span className="font-display text-sm text-ink-900">
                ~{formatUSD(cost)}
              </span>{" "}
              <span className="text-ink-500">
                at ${rate}/M chars for {voice.tier} voices
              </span>
            </>
          ) : (
            <span className="text-ink-500">unknown</span>
          )}
        </ConfirmRow>
      </dl>

      <p className="mt-3 text-[0.6rem] text-ink-500">
        Google&apos;s first {formatChars(freeQuota)} characters per month are
        free across the {voice.tier} tier. The estimate above is gross — your
        first regen each month effectively costs less.
      </p>

      {voice.mode === "premium" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-700">
          <AlertTriangle
            size={12}
            className="mt-0.5 flex-shrink-0 text-oxblood-700"
          />
          Premium voices cost {rate}× the standard tier and don&apos;t support
          live paragraph highlight while the audio plays.
        </p>
      )}

      {hasVoice && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-700">
          <AlertTriangle
            size={12}
            className="mt-0.5 flex-shrink-0 text-oxblood-700"
          />
          This will replace the existing voice audio for this book.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-ink-700 hover:bg-parchment-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex items-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-700 px-3 py-1.5 text-xs text-parchment-50 hover:bg-oxblood-800"
        >
          <Headphones size={12} />
          Confirm and regenerate
        </button>
      </div>
    </div>
  );
}

function ConfirmRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500 sm:w-40 sm:flex-shrink-0">
        {label}
      </dt>
      <dd className="flex-1 text-ink-800">{children}</dd>
    </div>
  );
}
