"use client";

import { useState } from "react";
import {
  BookOpen,
  Check,
  FileText,
  Headphones,
  Pencil,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import type { Note } from "@/lib/types";
import { noteTypeMeta } from "@/lib/notes";
import { NOTE_TYPE_ICON } from "./noteTypeIcons";

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onToggleDone: (note: Note) => void;
  onToggleStar: (note: Note) => void;
}

/** Tiny rgba helper so we can tint backgrounds/borders from a hex accent. */
function tint(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function sourceLabel(note: Note): string {
  const parts: string[] = [];
  if (note.anchor.page != null) parts.push(`p. ${note.anchor.page}`);
  const when = (note.created_at as { toDate?: () => Date } | undefined)?.toDate?.();
  if (when) parts.push(when.toLocaleDateString());
  return parts.join(" · ");
}

function MediumIcon({ note }: { note: Note }) {
  const cls = "text-ink-500";
  switch (note.anchor.medium) {
    case "pdf":
      return <FileText size={11} className={cls} />;
    case "epub":
      return <BookOpen size={11} className={cls} />;
    case "audio":
      return <Headphones size={11} className={cls} />;
    default:
      return null;
  }
}

export function NoteCard({
  note,
  onEdit,
  onDelete,
  onToggleDone,
  onToggleStar,
}: NoteCardProps) {
  const meta = noteTypeMeta(note.type);
  const Icon = NOTE_TYPE_ICON[note.type];
  const isExercise = note.type === "exercise";
  const done = note.done === true;
  const [confirming, setConfirming] = useState(false);

  return (
    <article
      className="group relative rounded-sm border bg-parchment-50 px-4 py-3 shadow-paper transition-shadow hover:shadow-paper-lg"
      style={{ borderColor: tint(meta.color, 0.28), borderLeftWidth: 3, borderLeftColor: meta.color }}
    >
      {/* Header: type + actions */}
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.12em]"
          style={{ backgroundColor: tint(meta.color, 0.12), color: meta.color }}
        >
          <Icon size={11} />
          {meta.label}
        </span>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onToggleStar(note)}
            aria-label={note.starred ? "Unstar" : "Star"}
            className={
              "rounded-sm p-1 transition-colors hover:bg-parchment-200 " +
              (note.starred ? "text-gold-500" : "text-ink-500 opacity-0 group-hover:opacity-100")
            }
          >
            <Star size={13} fill={note.starred ? "currentColor" : "transparent"} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(note)}
            aria-label="Edit note"
            className="rounded-sm p-1 text-ink-500 opacity-0 transition-colors hover:bg-parchment-200 hover:text-ink-900 group-hover:opacity-100"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirming) {
                onDelete(note);
              } else {
                setConfirming(true);
                window.setTimeout(() => setConfirming(false), 2600);
              }
            }}
            aria-label={confirming ? "Confirm delete" : "Delete note"}
            className={
              "rounded-sm p-1 transition-colors hover:bg-parchment-200 " +
              (confirming
                ? "text-oxblood-700"
                : "text-ink-500 opacity-0 hover:text-oxblood-700 group-hover:opacity-100")
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mt-2 flex gap-2.5">
        {isExercise && (
          <button
            type="button"
            onClick={() => onToggleDone(note)}
            aria-label={done ? "Mark not done" : "Mark done"}
            className={
              "mt-0.5 shrink-0 rounded-sm border p-0.5 transition-colors " +
              (done
                ? "border-forest-600/50 bg-forest-50 text-forest-600"
                : "border-ink-500/30 text-ink-500 hover:border-ink-700")
            }
          >
            {done ? <Check size={13} /> : <Square size={13} className="opacity-0" />}
          </button>
        )}

        <div className="min-w-0 flex-1">
          {note.quote && (
            <blockquote
              className="border-l-2 pl-3 font-display text-[0.95rem] italic leading-relaxed text-ink-800"
              style={{ borderColor: note.color ?? meta.color }}
            >
              “{note.quote}”
            </blockquote>
          )}
          {note.body && (
            <p
              className={
                "whitespace-pre-line text-sm leading-relaxed text-ink-800 " +
                (note.quote ? "mt-2 " : "") +
                (done ? "text-ink-500 line-through" : "")
              }
            >
              {note.body}
            </p>
          )}
          {!note.quote && !note.body && (
            <p className="text-sm italic text-ink-500">Empty note</p>
          )}
        </div>
      </div>

      {/* Footer meta */}
      <div className="mt-2 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-500">
        <MediumIcon note={note} />
        {sourceLabel(note)}
      </div>

      {confirming && (
        <p className="mt-1 text-right font-mono text-[0.58rem] uppercase tracking-[0.12em] text-oxblood-700">
          Tap delete again to confirm
        </p>
      )}
    </article>
  );
}
