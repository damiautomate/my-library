"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Input";
import {
  chapterOptions,
  createNote,
  HIGHLIGHT_COLORS,
  manualAnchor,
  NOTE_TYPE_META,
  NOTE_TYPE_ORDER,
  updateNote,
  type NoteSeed,
} from "@/lib/notes";
import type { Book, Note, NoteType } from "@/lib/types";
import { NOTE_TYPE_ICON } from "./noteTypeIcons";

interface NoteEditorProps {
  open: boolean;
  onClose: () => void;
  book: Book;
  userId: string;
  /** Present → edit mode. Absent → create mode. */
  editing: Note | null;
  /** Chapter to pre-select for a NEW note (auto-detected from reading pos). */
  defaultChapterIndex: number | null;
  /** Pre-fill for a NEW note started from a reader (e.g. "note this moment"). */
  seed?: NoteSeed | null;
}

export function NoteEditor({
  open,
  onClose,
  book,
  userId,
  editing,
  defaultChapterIndex,
  seed,
}: NoteEditorProps) {
  const options = useMemo(() => chapterOptions(book.epub_chapter_map), [book.epub_chapter_map]);

  const [type, setType] = useState<NoteType>("insight");
  const [chapterKey, setChapterKey] = useState<string>("");
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  // (Re)seed the form whenever the modal opens or the target note changes.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type);
      setChapterKey(editing.anchor.chapter_index == null ? "" : String(editing.anchor.chapter_index));
      setBody(editing.body);
      setQuote(editing.quote);
      setColor(editing.color);
      setDone(editing.done === true);
    } else {
      setType(seed?.type ?? "insight");
      const seededChapter = seed?.anchor?.chapter_index;
      setChapterKey(
        seededChapter != null
          ? String(seededChapter)
          : defaultChapterIndex == null
            ? ""
            : String(defaultChapterIndex),
      );
      setBody(seed?.body ?? "");
      setQuote(seed?.quote ?? "");
      setColor(seed?.color ?? null);
      setDone(false);
    }
  }, [open, editing, defaultChapterIndex, seed]);

  const canSave = body.trim().length > 0 || quote.trim().length > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const chapterIndex = chapterKey === "" ? null : Number(chapterKey);
      const chapterTitle =
        chapterIndex == null
          ? null
          : (options.find((o) => o.index === chapterIndex)?.title ?? null);
      const isExercise = type === "exercise";

      if (editing) {
        await updateNote(editing.id, {
          type,
          body: body.trim(),
          quote: quote.trim(),
          color,
          done: isExercise ? done : null,
          anchor: {
            ...editing.anchor,
            chapter_index: chapterIndex,
            chapter_title: chapterTitle,
          },
        });
      } else {
        const baseAnchor = seed?.anchor ?? manualAnchor(chapterIndex, chapterTitle);
        await createNote(userId, book.id, {
          type,
          body: body.trim(),
          quote: quote.trim(),
          color,
          done: isExercise ? done : null,
          anchor: {
            ...baseAnchor,
            chapter_index: chapterIndex,
            chapter_title: chapterTitle,
          },
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit note" : "New note"}
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Type picker */}
        <div>
          <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
            Kind of note
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NOTE_TYPE_ORDER.map((t) => {
              const meta = NOTE_TYPE_META[t];
              const Icon = NOTE_TYPE_ICON[t];
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] transition-colors"
                  style={
                    active
                      ? { backgroundColor: meta.color, color: "#FDFBF5", borderColor: meta.color }
                      : { color: meta.color, borderColor: `${meta.color}55` }
                  }
                >
                  <Icon size={11} />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs italic text-ink-500">{NOTE_TYPE_META[type].hint}</p>
        </div>

        {/* Chapter */}
        <Select
          label="Chapter"
          value={chapterKey}
          onChange={(e) => setChapterKey(e.target.value)}
          hint={
            book.epub_chapter_map && book.epub_chapter_map.length > 0
              ? undefined
              : "This book has no chapter map yet — convert it to EPUB to segment notes by chapter."
          }
        >
          {options.map((o) => (
            <option key={o.index ?? "unfiled"} value={o.index == null ? "" : String(o.index)}>
              {o.title}
            </option>
          ))}
        </Select>

        {/* Highlight colour (highlights only) */}
        {type === "highlight" && (
          <div>
            <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              Colour
            </p>
            <div className="flex items-center gap-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  aria-label={c.label}
                  onClick={() => setColor(color === c.hex ? null : c.hex)}
                  className={
                    "h-7 w-7 rounded-full border transition-transform hover:scale-110 " +
                    (color === c.hex ? "ring-2 ring-ink-700/40 ring-offset-1" : "")
                  }
                  style={{ backgroundColor: c.hex, borderColor: `${c.hex}AA` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Captured passage (optional) */}
        <Textarea
          label="Captured passage (optional)"
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          rows={2}
          placeholder="Paste or type a passage from the book…"
        />

        {/* Body */}
        <Textarea
          label="Your note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder={NOTE_TYPE_META[type].hint}
          hint="Plain text for now — rich formatting is coming."
        />

        {/* Exercise done */}
        {type === "exercise" && (
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => setDone(e.target.checked)}
              className="h-4 w-4 accent-forest-600"
            />
            Already completed
          </label>
        )}

        <div className="flex items-center justify-end gap-2 border-t ml-hairline pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add note"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
