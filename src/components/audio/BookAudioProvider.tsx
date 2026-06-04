"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Headphones,
  Pause,
  Play,
  Rewind,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getBook } from "@/lib/books";
import { getProgress } from "@/lib/progress";
import { chapterForPage } from "@/lib/chapters";
import { chapterForPageIndex, emptyAnchor, type NoteSeed } from "@/lib/notes";
import type { Book } from "@/lib/types";
import type {
  NarratingParagraph,
  VoiceReaderHandle,
} from "@/components/readers/VoiceReader";

const VoiceReader = dynamic(
  () => import("@/components/readers/VoiceReader").then((m) => m.VoiceReader),
  { ssr: false },
);

interface BookAudioValue {
  /** True when the book has narration available. */
  hasVoice: boolean;
  /** True once the engine handle is registered (controls usable). */
  ready: boolean;
  playing: boolean;
  /** Page currently narrated (null when paused) — drives reader highlight. */
  narratingPage: number | null;
  narratingParagraph: NarratingParagraph | null;
  /** Last known page, retained across pauses — for sync + "note this moment". */
  page: number | null;
  toggle: () => void;
  /** Positive = forward, negative = back. */
  nudge: (seconds: number) => void;
  /** Tell the engine where the member is reading (PDF/EPUB), so that when
   *  paused, playback realigns to follow them. Ignored while playing. */
  setExternalPage: (page: number | null) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  /** Build a note seed for whatever is being narrated right now. */
  currentSeed: () => NoteSeed;
}

const inert: BookAudioValue = {
  hasVoice: false,
  ready: false,
  playing: false,
  narratingPage: null,
  narratingParagraph: null,
  page: null,
  toggle: () => {},
  nudge: () => {},
  setExternalPage: () => {},
  expanded: false,
  setExpanded: () => {},
  currentSeed: () => ({ type: "reflection" }),
};

const Ctx = createContext<BookAudioValue | null>(null);

/** Read the shared per-book audio engine. Safe to call anywhere under the
 *  book layout; returns inert defaults elsewhere. */
export function useBookAudio(): BookAudioValue {
  return useContext(Ctx) ?? inert;
}

/**
 * Owns the ONE audio engine for a book. Mounted in the `[bookId]` layout, so
 * it persists across reader ↔ notebook navigation — audio keeps playing and
 * every page reads the same position. The engine (VoiceReader) is reused
 * unchanged; it lives in a docked player that any book page can see.
 */
export function BookAudioProvider({
  bookId,
  children,
}: {
  bookId: string;
  children: React.ReactNode;
}) {
  const { firebaseUser } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [resume, setResume] = useState<{
    initialPage?: number;
    initialSegmentIndex?: number;
    initialSeconds?: number;
  } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [narratingPage, setNarratingPage] = useState<number | null>(null);
  const [narratingParagraph, setNarratingParagraph] =
    useState<NarratingParagraph | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [externalPage, setExternalPageState] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const controlsRef = useRef<VoiceReaderHandle | null>(null);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    getBook(bookId)
      .then((b) => {
        if (!cancelled) setBook(b);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  useEffect(() => {
    if (!firebaseUser || !bookId) return;
    let cancelled = false;
    getProgress(firebaseUser.uid, bookId)
      .then((p) => {
        if (cancelled) return;
        setResume({
          initialPage: p?.current_page,
          initialSegmentIndex: p?.current_voice_segment_index,
          initialSeconds: p?.current_voice_seconds,
        });
        setPage(p?.current_page ?? null);
      })
      .catch(() => {
        if (!cancelled) setResume({});
      });
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, bookId]);

  const hasVoice = !!(book?.voice_segments && book.voice_segments.length > 0);

  const toggle = useCallback(() => {
    void controlsRef.current?.togglePlay();
  }, []);
  const nudge = useCallback((s: number) => {
    if (s < 0) controlsRef.current?.nudgeBackward(-s);
    else controlsRef.current?.nudgeForward(s);
  }, []);
  const setExternalPage = useCallback(
    (p: number | null) => setExternalPageState(p),
    [],
  );
  const currentSeed = useCallback((): NoteSeed => {
    const ch = chapterForPageIndex(book?.epub_chapter_map, page ?? undefined);
    return {
      type: "reflection",
      quote: narratingParagraph?.text ?? "",
      anchor: {
        ...emptyAnchor("audio"),
        chapter_index: ch.index,
        chapter_title: ch.title,
        page,
        paragraph_index: narratingParagraph?.paragraphIndex ?? null,
      },
    };
  }, [book, page, narratingParagraph]);

  const value = useMemo<BookAudioValue>(
    () => ({
      hasVoice,
      ready,
      playing,
      narratingPage,
      narratingParagraph,
      page,
      toggle,
      nudge,
      setExternalPage,
      expanded,
      setExpanded,
      currentSeed,
    }),
    [
      hasVoice,
      ready,
      playing,
      narratingPage,
      narratingParagraph,
      page,
      toggle,
      nudge,
      setExternalPage,
      expanded,
      currentSeed,
    ],
  );

  const canMount = !!(book && firebaseUser && resume && hasVoice);
  const chap = book ? chapterForPage(book.epub_chapter_map, page) : null;
  const nowPlaying = chap
    ? `${chap.title}${page ? ` · p.${page}` : ""}`
    : page
      ? `Page ${page}`
      : "Audio";

  return (
    <Ctx.Provider value={value}>
      {children}

      {canMount && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-3xl px-2 pb-2">
          <div className="overflow-hidden rounded-md border ml-hairline bg-parchment-50/95 shadow-paper-lg backdrop-blur">
            {/* Slim transport — always visible */}
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-oxblood-700 bg-oxblood-600 text-parchment-50 hover:bg-oxblood-700"
              >
                {playing ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                onClick={() => nudge(-30)}
                aria-label="Back 30 seconds"
                className="inline-flex items-center gap-1 rounded-sm border border-ink-500/20 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-700 hover:bg-parchment-100"
              >
                <Rewind size={12} /> 30
              </button>
              <button
                type="button"
                onClick={() => nudge(30)}
                aria-label="Forward 30 seconds"
                className="inline-flex items-center gap-1 rounded-sm border border-ink-500/20 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-700 hover:bg-parchment-100"
              >
                30 <FastForward size={12} />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Headphones size={12} className="shrink-0 text-ink-500" />
                <p className="truncate font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-700">
                  {nowPlaying}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Collapse player" : "Expand player"}
                className="shrink-0 rounded-sm p-1 text-ink-600 hover:bg-parchment-100"
              >
                {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            </div>

            {/* Full engine + UI — kept mounted (display:none when collapsed) so
                audio never stops. */}
            <div
              style={{ display: expanded ? "block" : "none" }}
              className="border-t ml-hairline p-2 sm:p-3"
            >
              <VoiceReader
                key={book!.id}
                segments={book!.voice_segments!}
                userId={firebaseUser!.uid}
                bookId={book!.id}
                initialPage={resume!.initialPage}
                initialSegmentIndex={resume!.initialSegmentIndex}
                initialSeconds={resume!.initialSeconds}
                externalPage={playing ? null : externalPage}
                totalPages={book!.page_count ?? undefined}
                chapterMap={book!.epub_chapter_map}
                bookTitle={book!.title}
                bookAuthors={book!.authors}
                coverUrl={book!.cover_url}
                onPageChange={setPage}
                onNarratingPage={(p) => {
                  setNarratingPage(p);
                  if (p != null) setPage(p);
                }}
                onNarratingParagraph={(info) => {
                  setNarratingParagraph(info);
                  if (info) setPage(info.page);
                }}
                onPlayingChange={setPlaying}
                onControlsReady={(h) => {
                  controlsRef.current = h;
                  setReady(!!h);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
