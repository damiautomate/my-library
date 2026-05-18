"use client";

import { useState } from "react";
import { Loader2, BookOpenCheck, Headphones, CheckCircle2 } from "lucide-react";
import { auth as firebaseAuth } from "@/lib/firebase/client";
import type { Book } from "@/lib/types";

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
    if (!confirm(
      hasVoice
        ? "Voice audio already exists. Re-generating will replace it. Continue?"
        : "Generate voice audio for this book? Uses Google TTS. Can take 5-15 minutes and consume your TTS quota.",
    )) return;
    setVoiceBusy(true);
    setVoiceResult(null);
    setVoiceErr(null);
    try {
      const res = await fetch(`/api/books/${book.id}/generate-voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ provider: "google" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Voice generation failed");
      setVoiceResult(
        `Generated ${data.segments} audio segments (${data.total_minutes} min total, ${data.characters.toLocaleString()} chars synthesized).`,
      );
      onChanged?.();
    } catch (err) {
      setVoiceErr(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceBusy(false);
    }
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
          onClick={generateVoice}
          disabled={voiceBusy}
          className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-ink-700 hover:bg-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {voiceBusy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Headphones size={12} />
          )}
          {hasVoice ? "Re-generate" : "Generate voice"}
        </button>
      </div>
      {voiceResult && (
        <p className="mt-2 text-xs text-forest-600">✓ {voiceResult}</p>
      )}
      {voiceErr && (
        <p className="mt-2 text-xs text-oxblood-700">{voiceErr}</p>
      )}
    </section>
  );
}
