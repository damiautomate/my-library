"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileText, Headphones, Mic, NotebookPen } from "lucide-react";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { getBook } from "@/lib/books";
import { proxyFileUrl } from "@/lib/cloudinary";
import { getProgress } from "@/lib/progress";
import type { Book, ReadingProgressDoc } from "@/lib/types";
import { useBookAudio } from "@/components/audio/BookAudioProvider";

// react-pdf and react-reader touch window/Worker APIs; ensure they only load
// in the browser by dynamically importing with ssr: false.
const PDFReader = dynamic(
  () => import("@/components/readers/PDFReader").then((m) => m.PDFReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="PDF" /> },
);

const EPUBReader = dynamic(
  () => import("@/components/readers/EPUBReader").then((m) => m.EPUBReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="EPUB" /> },
);

const AudioPlayer = dynamic(
  () => import("@/components/readers/AudioPlayer").then((m) => m.AudioPlayer),
  { ssr: false, loading: () => <ReaderSkeleton kind="audio summary" /> },
);

function ReaderSkeleton({ kind }: { kind: string }) {
  return (
    <div className="flex h-[60vh] items-center justify-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
      Loading {kind} reader…
    </div>
  );
}

type Mode = "pdf" | "voice" | "epub" | "audio";

export default function ReadPage() {
  return (
    <AuthGuard>
      <ReadContent />
    </AuthGuard>
  );
}

function ReadContent() {
  const params = useParams<{ bookId: string }>();
  const bookId = params?.bookId;
  const search = useSearchParams();
  const requestedMode = search.get("mode") as Mode | null;
  const { firebaseUser } = useAuth();
  const router = useRouter();

  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [progress, setProgress] = useState<ReadingProgressDoc | null>(null);
  const [livePct, setLivePct] = useState<number | null>(null);
  // Live page state shared across PDF / EPUB / Voice readers. When any reader
  // updates its page (user advances, voice plays through), this updates, and
  // the OTHER readers pick up the new initialPage when the user switches to
  // them. Keeps progress in sync across formats without re-fetching from
  // Firestore on every tab switch.
  const [livePage, setLivePage] = useState<number | null>(null);
  // The shared, per-book audio engine (mounted in the book layout). It lives
  // across reader ↔ notebook navigation, so playback never stops and every
  // page reads the same position.
  const audio = useBookAudio();
  const [proxyUrls, setProxyUrls] = useState<Partial<Record<Mode, string>>>({});

  // Resolve same-origin proxy URLs for each available format. Recomputed any
  // time the book or signed-in user changes (since the URL embeds an ID token).
  useEffect(() => {
    if (!book || !firebaseUser) return;
    let cancelled = false;
    (async () => {
      const next: Partial<Record<Mode, string>> = {};
      if (book.pdf_url) next.pdf = await proxyFileUrl(book.id, "pdf");
      if (book.epub_url) next.epub = await proxyFileUrl(book.id, "epub");
      if (book.audio_summary_url)
        next.audio = await proxyFileUrl(book.id, "audio");
      if (!cancelled) setProxyUrls(next);
    })().catch((err) => console.warn("[read] proxyFileUrl failed", err));
    return () => {
      cancelled = true;
    };
  }, [book, firebaseUser]);

  useEffect(() => {
    if (!bookId) return;
    getBook(bookId).then(setBook);
  }, [bookId]);

  useEffect(() => {
    if (!firebaseUser || !bookId) return;
    getProgress(firebaseUser.uid, bookId).then((p) => {
      setProgress(p);
      setLivePct(p?.current_percent ?? null);
      setLivePage(p?.current_page ?? null);
    });
  }, [firebaseUser, bookId]);

  if (book === undefined) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Pulling the volume…
        </p>
      </main>
    );
  }
  if (book === null) return notFound();
  if (!firebaseUser) return null;

  // Choose available modes
  const available: Mode[] = [];
  if (book.pdf_url) available.push("pdf");
  if (book.voice_segments && book.voice_segments.length > 0)
    available.push("voice");
  if (book.epub_url) available.push("epub");
  if (book.audio_summary_url) available.push("audio");

  if (available.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <BackBar bookId={bookId!} title={book.title} />
        <div className="ml-card mt-8 p-8 text-center">
          <p className="font-display text-2xl">Nothing to read yet.</p>
          <p className="mt-3 text-sm text-ink-600">
            The curator hasn't uploaded a PDF, EPUB, or audio summary for this
            book.
          </p>
        </div>
      </main>
    );
  }

  const mode: Mode = requestedMode && available.includes(requestedMode)
    ? requestedMode
    : available[0];

  const hasVoice =
    book.voice_segments != null && book.voice_segments.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-3 pb-16 pt-6 sm:px-6">
      <BackBar bookId={bookId!} title={book.title} pct={livePct} />

      {/* Mode switcher when multiple available */}
      {available.length > 1 && (
        <div className="my-4 flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
          {available.map((m) => (
            <button
              key={m}
              onClick={() => {
                if (m === "voice") audio.setExpanded(true);
                router.replace(`/book/${bookId}/read?mode=${m}`, {
                  scroll: false,
                });
              }}
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

      <div className="mt-4">
        {/* PDF and EPUB readers: mounted only when active (they're heavy and
            don't need to persist state across tab switches — initial page
            from livePage handles continuity). */}
        {mode === "pdf" && proxyUrls.pdf && (
          <PDFReader
            url={proxyUrls.pdf}
            userId={firebaseUser.uid}
            bookId={book.id}
            initialPage={livePage ?? progress?.current_page}
            currentReadingPage={audio.narratingPage}
            currentReadingParagraph={audio.narratingParagraph}
            voicePlaying={audio.playing}
            onVoiceTogglePlay={hasVoice ? audio.toggle : undefined}
            onVoiceNudgeBackward={hasVoice ? () => audio.nudge(-10) : undefined}
            onVoiceNudgeForward={hasVoice ? () => audio.nudge(10) : undefined}
            onPlayFromPage={hasVoice ? audio.playFromPage : undefined}
            onPercentChange={setLivePct}
            onPageChange={(p) => {
              setLivePage(p);
              audio.setExternalPage(p);
            }}
            chapterMap={book.epub_chapter_map}
          />
        )}
        {mode === "epub" && proxyUrls.epub && (
          <EPUBReader
            url={proxyUrls.epub}
            userId={firebaseUser.uid}
            bookId={book.id}
            initialCfi={progress?.current_cfi}
            chapterMap={book.epub_chapter_map}
            externalPage={livePage}
            currentReadingPage={audio.narratingPage}
            currentReadingParagraph={audio.narratingParagraph}
            onPercentChange={setLivePct}
          />
        )}

        {/* Narration is played by the shared dock at the bottom of the screen,
            so it keeps playing across the reader and the notebook. The voice
            tab points the member to it. */}
        {mode === "voice" && (
          <div className="ml-card mt-2 px-6 py-12 text-center">
            <p className="font-display text-xl text-ink-800">
              {hasVoice
                ? "Narration plays in the dock below."
                : "No narration for this book yet."}
            </p>
            {hasVoice && (
              <button
                type="button"
                onClick={() => audio.setExpanded(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-600 px-4 py-2 text-sm font-medium text-parchment-50 hover:bg-oxblood-700"
              >
                Open the player
              </button>
            )}
          </div>
        )}

        {mode === "audio" && proxyUrls.audio && (
          <AudioPlayer
            url={proxyUrls.audio}
            userId={firebaseUser.uid}
            bookId={book.id}
            initialSeconds={progress?.current_audio_seconds}
            durationHint={book.audio_summary_duration_seconds}
            onPercentChange={setLivePct}
          />
        )}
        {mode !== "voice" && !proxyUrls[mode as Exclude<Mode, "voice">] && (
          <p className="py-10 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Preparing the {mode} reader…
          </p>
        )}
      </div>

      {/* Mark-as-finished prompt */}
      {livePct !== null && livePct >= 95 && progress?.status !== "finished" && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-sm border border-forest-600/40 bg-forest-50 px-5 py-4">
          <div>
            <p className="font-display text-lg text-forest-600">
              You're nearly through. Mark as finished?
            </p>
            <p className="mt-1 text-xs text-ink-600">
              You'll be prompted for a rating and a closing note.
            </p>
          </div>
          <Link href={`/book/${bookId}?finish=1`}>
            <Button variant="primary">Mark finished</Button>
          </Link>
        </div>
      )}
    </main>
  );
}

function BackBar({
  bookId,
  title,
  pct,
}: {
  bookId: string;
  title: string;
  pct?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b ml-hairline pb-3">
      <Link
        href={`/book/${bookId}`}
        className="flex items-center gap-1.5 text-sm text-ink-700 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        <span className="font-display text-base">{title}</span>
      </Link>
      <div className="flex items-center gap-3">
        {pct !== null && pct !== undefined && (
          <div className="flex items-center gap-2">
            <div className="h-1 w-28 overflow-hidden rounded-full bg-parchment-200 sm:w-40">
              <div
                className="h-full bg-oxblood-600"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-xs text-ink-700">{pct}%</span>
          </div>
        )}
        <Link
          href={`/book/${bookId}/notes`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-500/25 bg-parchment-50 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-700 hover:bg-parchment-100"
          aria-label="Open notebook"
        >
          <NotebookPen size={12} />
          <span className="hidden sm:inline">Notes</span>
        </Link>
      </div>
    </div>
  );
}
