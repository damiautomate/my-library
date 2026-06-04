"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Headphones, PenLine } from "lucide-react";
import { getProgress } from "@/lib/progress";
import { chapterForPageIndex, emptyAnchor, type NoteSeed } from "@/lib/notes";
import type { Book } from "@/lib/types";
import type { NarratingParagraph } from "@/components/readers/VoiceReader";

// VoiceReader touches audio/Worker APIs — browser only, like the read page.
const VoiceReader = dynamic(
  () => import("@/components/readers/VoiceReader").then((m) => m.VoiceReader),
  {
    ssr: false,
    loading: () => (
      <p className="py-8 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
        Loading audio…
      </p>
    ),
  },
);

interface Resume {
  initialPage?: number;
  initialSegmentIndex?: number;
  initialSeconds?: number;
}

/**
 * A "listen while you annotate" panel for the notebook. It mounts the same
 * VoiceReader the reader uses, resuming from the member's saved position, and
 * surfaces a "Note this moment" action that seeds a note anchored to whatever
 * is currently being narrated (page + paragraph + chapter).
 */
export function NotebookAudio({
  book,
  userId,
  onNoteThisMoment,
}: {
  book: Book;
  userId: string;
  onNoteThisMoment: (seed: NoteSeed) => void;
}) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Last known narration position, retained across pauses.
  const [page, setPage] = useState<number | null>(null);
  const [para, setPara] = useState<{ index: number; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProgress(userId, book.id)
      .then((p) => {
        if (cancelled) return;
        setResume({
          initialPage: p?.current_page,
          initialSegmentIndex: p?.current_voice_segment_index,
          initialSeconds: p?.current_voice_seconds,
        });
        setPage(p?.current_page ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, book.id]);

  function handleNoteThisMoment() {
    const pg = para ? page : (page ?? resume?.initialPage ?? null);
    const ch = chapterForPageIndex(book.epub_chapter_map, pg ?? undefined);
    onNoteThisMoment({
      type: "reflection",
      quote: para?.text ?? "",
      anchor: {
        ...emptyAnchor("audio"),
        chapter_index: ch.index,
        chapter_title: ch.title,
        page: pg,
        paragraph_index: para?.index ?? null,
      },
    });
  }

  return (
    <section className="ml-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b ml-hairline bg-parchment-100/50 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-ink-600">
          <Headphones size={12} />
          Listen while you annotate
        </span>
        <button
          type="button"
          onClick={handleNoteThisMoment}
          className="inline-flex items-center gap-1.5 rounded-full border border-oxblood-600/50 bg-oxblood-50 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-oxblood-700 hover:bg-oxblood-50/70"
        >
          <PenLine size={12} />
          Note this moment
        </button>
      </div>
      <div className="p-3 sm:p-4">
        {loaded && book.voice_segments && book.voice_segments.length > 0 ? (
          <VoiceReader
            segments={book.voice_segments}
            userId={userId}
            bookId={book.id}
            initialPage={resume?.initialPage}
            initialSegmentIndex={resume?.initialSegmentIndex}
            initialSeconds={resume?.initialSeconds}
            totalPages={book.page_count ?? undefined}
            chapterMap={book.epub_chapter_map}
            bookTitle={book.title}
            bookAuthors={book.authors}
            coverUrl={book.cover_url}
            onPageChange={(p) => setPage(p)}
            onNarratingPage={(p) => {
              if (p != null) setPage(p);
            }}
            onNarratingParagraph={(info: NarratingParagraph | null) => {
              if (info) {
                setPage(info.page);
                setPara({ index: info.paragraphIndex, text: info.text });
              }
            }}
          />
        ) : (
          <p className="py-8 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Loading audio…
          </p>
        )}
      </div>
    </section>
  );
}
