"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  LayoutList,
  Plus,
  Tags,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import { NotebookAudio } from "./NotebookAudio";
import { NOTE_TYPE_ICON } from "./noteTypeIcons";
import {
  chapterForPageIndex,
  deleteNote,
  groupNotesByChapter,
  groupNotesByType,
  toggleNoteDone,
  updateNote,
  watchBookNotes,
  type NoteSeed,
} from "@/lib/notes";
import { getProgress } from "@/lib/progress";
import type { Book, Note } from "@/lib/types";

type View = "chapter" | "type";

export function Notebook({ book, userId }: { book: Book; userId: string }) {
  const [notes, setNotes] = useState<Note[] | undefined>(undefined);
  const [view, setView] = useState<View>("chapter");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [seed, setSeed] = useState<NoteSeed | null>(null);
  const [defaultChapterIndex, setDefaultChapterIndex] = useState<number | null>(null);

  // Live notes.
  useEffect(() => {
    return watchBookNotes(userId, book.id, setNotes);
  }, [userId, book.id]);

  // Auto-detect the chapter the member is currently on so new notes default
  // to the right place.
  useEffect(() => {
    getProgress(userId, book.id)
      .then((p) => {
        const { index } = chapterForPageIndex(book.epub_chapter_map, p?.current_page);
        setDefaultChapterIndex(index);
      })
      .catch(() => setDefaultChapterIndex(null));
  }, [userId, book.id, book.epub_chapter_map]);

  const stats = useMemo(() => {
    const list = notes ?? [];
    const annotated = new Set(
      list.filter((n) => n.anchor.chapter_index != null).map((n) => n.anchor.chapter_index),
    ).size;
    return {
      total: list.length,
      annotated,
      totalChapters: book.epub_chapter_map?.length ?? 0,
    };
  }, [notes, book.epub_chapter_map]);

  function openNew() {
    setEditing(null);
    setSeed(null);
    setEditorOpen(true);
  }
  function openEdit(note: Note) {
    setEditing(note);
    setSeed(null);
    setEditorOpen(true);
  }
  function openSeeded(s: NoteSeed) {
    setEditing(null);
    setSeed(s);
    setEditorOpen(true);
  }

  const chapterGroups = useMemo(
    () => (notes ? groupNotesByChapter(notes, book.epub_chapter_map) : []),
    [notes, book.epub_chapter_map],
  );
  const typeGroups = useMemo(() => (notes ? groupNotesByType(notes) : []), [notes]);

  const cardHandlers = {
    onEdit: openEdit,
    onDelete: (n: Note) => void deleteNote(n.id),
    onToggleDone: (n: Note) => void toggleNoteDone(n.id, !(n.done === true)),
    onToggleStar: (n: Note) => void updateNote(n.id, { starred: !n.starred }),
  };

  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b ml-hairline pb-3">
        <Link
          href={`/book/${book.id}`}
          className="flex min-w-0 items-center gap-1.5 text-sm text-ink-700 hover:text-ink-900"
        >
          <ArrowLeft size={14} className="shrink-0" />
          <span className="truncate font-display text-base">{book.title}</span>
        </Link>
        <Link
          href={`/book/${book.id}/read`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-500/25 bg-parchment-50 px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-700 hover:bg-parchment-100"
        >
          <BookOpen size={12} />
          Reader
        </Link>
      </div>

      {/* Title + stats */}
      <header className="mt-6">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-oxblood-700">
          Notebook
        </p>
        <h1 className="mt-2 font-display text-3xl leading-[1.05] tracking-tightest sm:text-4xl">
          {book.title}
        </h1>
        <p className="mt-3 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-ink-500">
          {stats.total} {stats.total === 1 ? "note" : "notes"}
          {stats.totalChapters > 0 && (
            <> · {stats.annotated} of {stats.totalChapters} chapters annotated</>
          )}
        </p>
      </header>

      {/* Listen-while-you-annotate (books with narration) */}
      {(book.voice_segments?.length ?? 0) > 0 && (
        <div className="mt-5">
          <NotebookAudio onNoteThisMoment={openSeeded} />
        </div>
      )}

      {/* Controls */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="primary" size="sm" onClick={openNew}>
          <Plus size={14} />
          New note
        </Button>

        <div className="flex items-center gap-1 font-mono text-[0.62rem] uppercase tracking-[0.12em]">
          <ViewTab active={view === "chapter"} onClick={() => setView("chapter")} icon={<LayoutList size={12} />}>
            Chapter
          </ViewTab>
          <ViewTab active={view === "type"} onClick={() => setView("type")} icon={<Tags size={12} />}>
            Type
          </ViewTab>
        </div>
      </div>

      {/* Body */}
      <div className="mt-7">
        {notes === undefined ? (
          <p className="py-16 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Opening your notebook…
          </p>
        ) : notes.length === 0 ? (
          <EmptyState onNew={openNew} />
        ) : view === "chapter" ? (
          <div className="space-y-9">
            {chapterGroups.map((g) => (
              <section key={g.index ?? "unfiled"}>
                <GroupHeader eyebrow={g.index == null ? "" : "Chapter"} title={g.title} count={g.notes.length} />
                <div className="mt-3 space-y-3">
                  {g.notes.map((n) => (
                    <NoteCard key={n.id} note={n} {...cardHandlers} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-9">
            {typeGroups.map((g) => {
              const Icon = NOTE_TYPE_ICON[g.type];
              return (
                <section key={g.type}>
                  <GroupHeader
                    title={g.meta.label}
                    count={g.notes.length}
                    color={g.meta.color}
                    icon={<Icon size={13} />}
                  />
                  <div className="mt-3 space-y-3">
                    {g.notes.map((n) => (
                      <NoteCard key={n.id} note={n} {...cardHandlers} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <NoteEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        book={book}
        userId={userId}
        editing={editing}
        defaultChapterIndex={defaultChapterIndex}
        seed={seed}
      />
    </main>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors " +
        (active
          ? "border-oxblood-600/60 bg-oxblood-50 text-oxblood-700"
          : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
      }
    >
      {icon}
      {children}
    </button>
  );
}

function GroupHeader({
  eyebrow,
  title,
  count,
  color,
  icon,
}: {
  eyebrow?: string;
  title: string;
  count: number;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 border-b ml-hairline pb-1.5">
      {icon && (
        <span className="self-center" style={color ? { color } : undefined}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {eyebrow ? (
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
            {eyebrow}
          </span>
        ) : null}
        <h2
          className="font-display text-lg leading-tight"
          style={color ? { color } : undefined}
        >
          {title}
        </h2>
      </div>
      <span className="ml-auto font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-500">
        {count}
      </span>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="ml-card px-6 py-12 text-center">
      <p className="font-display text-2xl text-ink-800">Your notebook is empty.</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-600">
        Reading without writing is reading half. Capture an insight, a question,
        or something you want to act on — your notes group themselves by chapter
        as you go.
      </p>
      <div className="mt-6">
        <Button variant="primary" onClick={onNew}>
          <Plus size={14} />
          Write your first note
        </Button>
      </div>
    </div>
  );
}
