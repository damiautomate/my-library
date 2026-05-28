"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FileText, Mic, BookOpen, Headphones, Share2 } from "lucide-react";
import type { SharedBook } from "@/lib/types";
import type {
  VoiceReaderHandle,
  NarratingParagraph,
} from "@/components/readers/VoiceReader";
import { BookCover } from "@/components/library/BookCover";
import { GUEST_USER_ID, getGuestProgress } from "@/lib/progress";

const PDFReader = dynamic(
  () => import("@/components/readers/PDFReader").then((m) => m.PDFReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="PDF" /> },
);
const EPUBReader = dynamic(
  () => import("@/components/readers/EPUBReader").then((m) => m.EPUBReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="EPUB" /> },
);
const VoiceReader = dynamic(
  () => import("@/components/readers/VoiceReader").then((m) => m.VoiceReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="audio" /> },
);
const AudioPlayer = dynamic(
  () => import("@/components/readers/AudioPlayer").then((m) => m.AudioPlayer),
  { ssr: false, loading: () => <ReaderSkeleton kind="audio summary" /> },
);

function ReaderSkeleton({ kind }: { kind: string }) {
  return (
    <div className="flex h-[55vh] items-center justify-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
      Loading {kind} reader…
    </div>
  );
}

type Mode = "pdf" | "voice" | "epub" | "audio";

export function ShareReader({ token }: { token: string }) {
  const [book, setBook] = useState<SharedBook | null | undefined>(undefined);
  const [errored, setErrored] = useState(false);
  const [mode, setMode] = useState<Mode>("pdf");

  // Cross-reader shared state — mirrors the member read page so the PDF can
  // follow the voice, etc.
  const [livePage, setLivePage] = useState<number | null>(null);
  const [, setLivePct] = useState<number | null>(null);
  const [voicePage, setVoicePage] = useState<number | null>(null);
  const [voiceParagraph, setVoiceParagraph] =
    useState<NarratingParagraph | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const voiceControlsRef = useRef<VoiceReaderHandle | null>(null);

  // Anonymous reading position, restored from localStorage.
  const guest = useMemo(() => getGuestProgress(book?.id ?? ""), [book?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/share/${token}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setErrored(true);
            setBook(null);
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const b = data.book as SharedBook;
        setBook(b);
        // Default to the first available reader.
        setMode(
          b.has_pdf
            ? "pdf"
            : b.has_voice
              ? "voice"
              : b.has_epub
                ? "epub"
                : "audio",
        );
      } catch {
        if (!cancelled) {
          setErrored(true);
          setBook(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Token-authorized file URLs (PDF/EPUB/audio). Voice segments use their own
  // URLs from the payload.
  const fileUrl = useCallback(
    (kind: "pdf" | "epub" | "audio") =>
      `/api/file/${book?.id}/${kind}?share=${encodeURIComponent(token)}`,
    [book?.id, token],
  );

  // ---- Voice control wiring (mirrors read page) ----
  const handleVoiceControlsReady = useCallback(
    (h: VoiceReaderHandle | null) => {
      voiceControlsRef.current = h;
    },
    [],
  );
  const handleVoiceTogglePlay = useCallback(() => {
    void voiceControlsRef.current?.togglePlay();
  }, []);
  const handleVoiceNudgeBack = useCallback(() => {
    voiceControlsRef.current?.nudgeBackward(10);
  }, []);
  const handleVoiceNudgeForward = useCallback(() => {
    voiceControlsRef.current?.nudgeForward(10);
  }, []);

  const onShare = useCallback(async () => {
    const url = window.location.href;
    // Native share sheet on mobile; clipboard fallback on desktop.
    if (navigator.share) {
      try {
        await navigator.share({ title: book?.title ?? "A book", url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  }, [book?.title]);

  if (book === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment-100">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Opening the book…
        </p>
      </div>
    );
  }

  if (errored || book === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-parchment-100 px-6 text-center">
        <BookOpen size={40} className="text-ink-500/40" />
        <h1 className="font-display text-2xl text-ink-900">
          This link isn’t available
        </h1>
        <p className="max-w-sm text-sm text-ink-600">
          The share link may have been turned off, or it’s incorrect. Ask
          whoever sent it to share it again.
        </p>
      </div>
    );
  }

  const available: Mode[] = [];
  if (book.has_pdf) available.push("pdf");
  if (book.has_voice) available.push("voice");
  if (book.has_epub) available.push("epub");
  if (book.has_audio_summary) available.push("audio");

  return (
    <main className="min-h-screen bg-parchment-100">
      {/* Masthead — gift-like presentation of the single shared book */}
      <header className="border-b ml-hairline bg-parchment-50">
        <div className="mx-auto max-w-3xl px-4 pb-6 pt-8 sm:px-6 sm:pt-10">
          <div className="flex items-start gap-4 sm:gap-6">
            <div className="w-20 shrink-0 overflow-hidden rounded-sm border ml-hairline bg-parchment-200 shadow-paper-lg sm:w-28">
              <div className="aspect-[2/3]">
                <BookCover url={book.cover_url} alt={book.title} fallbackSize={32} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-oxblood-700">
                Shared with you
              </p>
              <h1 className="mt-1.5 font-display text-2xl leading-tight tracking-tight text-ink-900 sm:text-3xl">
                {book.title}
              </h1>
              {book.authors?.length ? (
                <p className="mt-1 text-sm text-ink-600">
                  {book.authors.join(", ")}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onShare}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-ink-500/25 bg-parchment-50 px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-700 hover:bg-parchment-100"
              >
                <Share2 size={11} />
                Share
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-3 pb-20 pt-4 sm:px-6">
        {/* Mode switcher */}
        {available.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
            {available.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 " +
                  (mode === m
                    ? "border-oxblood-600/60 bg-oxblood-50 text-oxblood-700"
                    : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
                }
              >
                {m === "pdf" && <FileText size={11} />}
                {m === "voice" && <Mic size={11} />}
                {m === "epub" && <BookOpen size={11} />}
                {m === "audio" && <Headphones size={11} />}
                {m === "audio" ? "summary" : m}
              </button>
            ))}
          </div>
        )}

        {mode === "pdf" && book.has_pdf && (
          <PDFReader
            url={fileUrl("pdf")}
            userId={GUEST_USER_ID}
            bookId={book.id}
            initialPage={livePage ?? guest?.current_page}
            currentReadingPage={voicePage}
            currentReadingParagraph={voiceParagraph}
            voicePlaying={voicePlaying}
            onVoiceTogglePlay={book.has_voice ? handleVoiceTogglePlay : undefined}
            onVoiceNudgeBackward={book.has_voice ? handleVoiceNudgeBack : undefined}
            onVoiceNudgeForward={
              book.has_voice ? handleVoiceNudgeForward : undefined
            }
            onPercentChange={setLivePct}
            onPageChange={setLivePage}
          />
        )}

        {mode === "epub" && book.has_epub && (
          <EPUBReader
            url={fileUrl("epub")}
            userId={GUEST_USER_ID}
            bookId={book.id}
            initialCfi={guest?.current_cfi}
            chapterMap={book.chapter_map}
            externalPage={livePage}
            currentReadingPage={voicePage}
            currentReadingParagraph={voiceParagraph}
            onPercentChange={setLivePct}
          />
        )}

        {book.has_voice && book.voice_segments && (
          <div style={{ display: mode === "voice" ? "block" : "none" }}>
            <VoiceReader
              segments={book.voice_segments}
              userId={GUEST_USER_ID}
              bookId={book.id}
              initialPage={livePage ?? guest?.current_page}
              initialSegmentIndex={guest?.current_voice_segment_index}
              initialSeconds={guest?.current_voice_seconds}
              externalPage={mode === "voice" ? undefined : livePage}
              totalPages={book.page_count ?? undefined}
              chapterMap={book.chapter_map}
              bookTitle={book.title}
              bookAuthors={book.authors}
              coverUrl={book.cover_url}
              onPercentChange={setLivePct}
              onPageChange={setLivePage}
              onNarratingPage={setVoicePage}
              onNarratingParagraph={setVoiceParagraph}
              onPlayingChange={setVoicePlaying}
              onControlsReady={handleVoiceControlsReady}
            />
          </div>
        )}

        {mode === "audio" && book.has_audio_summary && (
          <AudioPlayer
            url={fileUrl("audio")}
            userId={GUEST_USER_ID}
            bookId={book.id}
            initialSeconds={guest?.current_audio_seconds}
            onPercentChange={setLivePct}
          />
        )}

        <p className="mt-10 text-center font-mono text-[0.55rem] uppercase tracking-[0.2em] text-ink-500/70">
          A single book, shared from the library
        </p>
      </div>
    </main>
  );
}
