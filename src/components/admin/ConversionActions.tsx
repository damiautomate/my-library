"use client";

import { useRef, useState } from "react";
import { Loader2, BookOpenCheck, Headphones, CheckCircle2, X } from "lucide-react";
import { auth as firebaseAuth } from "@/lib/firebase/client";
import type { Book } from "@/lib/types";
import { NarratorPicker } from "./NarratorPicker";

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
    if (
      !confirm(
        reset
          ? "Voice audio already exists. Re-generating from scratch will replace it. Continue?"
          : "Generate voice audio for this book? Uses Google TTS. Processes one ~10-page segment per HTTP call — you can leave this page open and it'll keep going. For a 300-page book expect ~30 segments at ~30-60s each.",
      )
    )
      return;
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
          onClick={voiceBusy ? cancelVoice : generateVoice}
          disabled={false}
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
