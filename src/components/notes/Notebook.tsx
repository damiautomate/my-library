"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Download,
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
  reorderChapter,
  toggleNoteDone,
  updateNote,
  watchBookNotes,
  type NoteSeed,
} from "@/lib/notes";
import { computeCompletion } from "@/lib/completion";
import {
  downloadText,
  notebookToMarkdown,
  safeFilename,
} from "@/lib/notebook-export";
import { getProgress } from "@/lib/progress";
import type { Book, Note, ReadingProgressDoc } from "@/lib/types";

type View = "chapter" | "type";

export function Notebook({ book, userId }: { book: Book; userId: string }) {
  const [notes, setNotes] = useState<Note[] | undefined>(undefined);
  const [view, setView] = useState<View>("chapter");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [seed, setSeed] = useState<NoteSeed | null>(null);
  const [defaultChapterIndex, setDefaultChapterIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<ReadingProgressDoc | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Live notes.
  useEffect(() => {
    return watchBookNotes(userId, book.id, setNotes);
  }, [userId, book.id]);

  // Auto-detect the chapter the member is currently on so new notes default
  // to the right place.
  useEffect(() => {
    getProgress(userId, book.id)
      .then((p) => {
        setProgress(p ?? null);
        const { index } = chapterForPageIndex(book.epub_chapter_map, p?.current_page);
        setDefaultChapterIndex(index);
      })
      .catch(() => {
        setProgress(null);
        setDefaultChapterIndex(null);
      });
  }, [userId, book.id, book.epub_chapter_map]);

  const totalNotes = notes?.length ?? 0;
  const completion = useMemo(
    () =>
      computeCompletion(
        book.epub_chapter_map,
        notes ?? [],
        progress,
        book.page_count,
      ),
    [book.epub_chapter_map, book.page_count, notes, progress],
  );

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

  // Move a note within its (already sorted) chapter group. Optimistically
  // rewrites local order so the UI responds instantly, then persists.
  function moveNote(group: Note[], index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= group.length) return;
    const reordered = [...group];
    const [item] = reordered.splice(index, 1);
    reordered.splice(j, 0, item);
    const orderById = new Map(reordered.map((n, i) => [n.id, i]));
    setNotes((prev) =>
      prev?.map((n) =>
        orderById.has(n.id) ? { ...n, order: orderById.get(n.id)! } : n,
      ),
    );
    void reorderChapter(reordered);
  }

  function buildMarkdown() {
    return notebookToMarkdown(
      { title: book.title, authors: book.authors },
      chapterGroups,
      completion,
    );
  }
  function exportMarkdown() {
    downloadText(`${safeFilename(book.title)}-notebook.md`, buildMarkdown());
    setExportOpen(false);
  }
  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(buildMarkdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — ignore */
    }
    setExportOpen(false);
  }

  const completionByChapter = new Map(
    (completion?.chapters ?? []).map((c) => [c.index, c]),
  );

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
          {totalNotes} {totalNotes === 1 ? "note" : "notes"}
        </p>

        {completion && completion.totalChapters > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-600">
              <span>{completion.overallPercent}% complete</span>
              <span className="text-ink-500">
                {completion.completedChapters}/{completion.totalChapters} chapters
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-parchment-200">
              <div
                className="h-full rounded-full bg-oxblood-600 transition-all"
                style={{ width: `${completion.overallPercent}%` }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-500">
              {completion.readChapters} read · {completion.annotatedChapters} annotated
            </p>
          </div>
        )}
      </header>

      {/* Listen-while-you-annotate (books with narration) */}
      {(book.voice_segments?.length ?? 0) > 0 && (
        <div className="mt-5">
          <NotebookAudio onNoteThisMoment={openSeeded} />
        </div>
      )}

      {/* Controls */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={openNew}>
            <Plus size={14} />
            New note
          </Button>
          {totalNotes > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-500/25 bg-parchment-50 px-2.5 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-700 hover:bg-parchment-100"
              >
                {copied ? <Check size={12} /> : <Download size={12} />}
                {copied ? "Copied" : "Export"}
              </button>
              {exportOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setExportOpen(false)}
                  />
                  <div className="absolute left-0 z-40 mt-1 w-48 overflow-hidden rounded-sm border ml-hairline bg-parchment-50 shadow-paper-lg">
                    <button
                      type="button"
                      onClick={exportMarkdown}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-800 hover:bg-parchment-100"
                    >
                      <Download size={13} /> Download .md
                    </button>
                    <button
                      type="button"
                      onClick={copyMarkdown}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-800 hover:bg-parchment-100"
                    >
                      <Copy size={13} /> Copy to clipboard
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

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
            {chapterGroups.map((g) => {
              const cc =
                g.index == null ? undefined : completionByChapter.get(g.index);
              return (
                <section key={g.index ?? "unfiled"}>
                  <GroupHeader
                    eyebrow={g.index == null ? "" : "Chapter"}
                    title={g.title}
                    count={g.notes.length}
                    read={cc?.read}
                    annotated={cc?.annotated}
                  />
                  <div className="mt-3 space-y-3">
                    {g.notes.map((n, idx) => (
                      <NoteCard
                        key={n.id}
                        note={n}
                        {...cardHandlers}
                        onMoveUp={
                          idx > 0 ? () => moveNote(g.notes, idx, -1) : undefined
                        }
                        onMoveDown={
                          idx < g.notes.length - 1
                            ? () => moveNote(g.notes, idx, 1)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}
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
  read,
  annotated,
}: {
  eyebrow?: string;
  title: string;
  count: number;
  color?: string;
  icon?: React.ReactNode;
  read?: boolean;
  annotated?: boolean;
}) {
  const showStatus = read !== undefined || annotated !== undefined;
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
      <div className="ml-auto flex items-center gap-2 self-center">
        {showStatus && (
          <span className="flex items-center gap-1">
            <StatusDot on={!!read} label="Read" />
            <StatusDot on={!!annotated} label="Noted" />
          </span>
        )}
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-ink-500">
          {count}
        </span>
      </div>
    </div>
  );
}

function StatusDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      title={on ? label : `Not ${label.toLowerCase()}`}
      className={
        "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[0.52rem] uppercase tracking-[0.1em] " +
        (on
          ? "border-forest-600/40 bg-forest-50 text-forest-600"
          : "border-ink-500/20 text-ink-400")
      }
    >
      {on && <Check size={9} />}
      {label}
    </span>
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
