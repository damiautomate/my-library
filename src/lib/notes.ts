import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase/client";
import { chapterForPage } from "./chapters";
import type {
  EpubChapterMapping,
  Note,
  NoteAnchor,
  NoteDoc,
  NoteMedium,
  NoteType,
} from "./types";

const COL = "book_notes";

// ============================================================
// CATALOG — note types & highlight colours
// ============================================================

export interface NoteTypeMeta {
  /** Display label. */
  label: string;
  /** Accent colour (hex). Applied via inline style so arbitrary semantic
   *  colours survive Tailwind's purge (dynamic class names would not). */
  color: string;
  /** One-line prompt shown in the composer / empty states. */
  hint: string;
}

/**
 * The note-type catalog. The KEY ORDER here is the canonical order used by the
 * "by type" view and the type picker, so keep the most-reached-for types first.
 */
export const NOTE_TYPE_META: Record<NoteType, NoteTypeMeta> = {
  highlight: {
    label: "Highlight",
    color: "#C9A961",
    hint: "A passage worth marking.",
  },
  insight: {
    label: "Insight",
    color: "#7B2D26",
    hint: "The idea you don't want to forget.",
  },
  reflection: {
    label: "Reflection",
    color: "#5C4A3A",
    hint: "How does this land for you?",
  },
  question: {
    label: "Question",
    color: "#3F5E78",
    hint: "Something to sit with or look up.",
  },
  action: {
    label: "Action",
    color: "#1F3D2F",
    hint: "Something to actually do.",
  },
  exercise: {
    label: "Exercise",
    color: "#B5703A",
    hint: "A task the book sets. Tick it when done.",
  },
  vocabulary: {
    label: "Vocabulary",
    color: "#3E6B66",
    hint: "A term and what it means.",
  },
  summary: {
    label: "Summary",
    color: "#3D2E22",
    hint: "Your own recap, in a sentence or two.",
  },
  meditation: {
    label: "Meditation",
    color: "#6B4E71",
    hint: "A prompt to dwell on.",
  },
};

/** Canonical type order (object insertion order is stable for string keys). */
export const NOTE_TYPE_ORDER = Object.keys(NOTE_TYPE_META) as NoteType[];

export function noteTypeMeta(type: NoteType): NoteTypeMeta {
  return NOTE_TYPE_META[type] ?? NOTE_TYPE_META.highlight;
}

export interface HighlightColor {
  /** Stored on the note as `color`. */
  hex: string;
  label: string;
  /** Type the composer pre-selects when this colour is picked. */
  suggests: NoteType;
}

/**
 * Semantic highlight colours. Picking a colour can pre-suggest a note type
 * (yellow→passage, blue→definition, …). Used by the in-reader highlight UI in
 * Phase B; defined here now so the model is complete and shared.
 */
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { hex: "#E8C766", label: "Gold", suggests: "highlight" },
  { hex: "#6E97B8", label: "Blue", suggests: "vocabulary" },
  { hex: "#6FA07A", label: "Green", suggests: "action" },
  { hex: "#C98BA0", label: "Rose", suggests: "question" },
  { hex: "#9B83B0", label: "Plum", suggests: "insight" },
];

// ============================================================
// ANCHORS
// ============================================================

/** An empty anchor with sensible defaults — spread over with what you know. */
export function emptyAnchor(medium: NoteMedium): NoteAnchor {
  return {
    medium,
    chapter_index: null,
    chapter_title: null,
    page: null,
    paragraph_index: null,
    cfi: null,
    cfi_range: null,
    audio_seconds: null,
    rects: null,
  };
}

/** Resolve the chapter (index + title) that a source page falls in. Returns
 *  `{ index: null }` for front matter or when the book has no chapter map. */
export function chapterForPageIndex(
  map: EpubChapterMapping[] | undefined,
  page: number | null | undefined,
): { index: number | null; title: string | null } {
  const ch = chapterForPage(map, page);
  if (!ch) return { index: null, title: null };
  return { index: ch.index, title: ch.title };
}

/** Build a manual-note anchor pinned to a chapter (no page/selection). */
export function manualAnchor(
  chapterIndex: number | null,
  chapterTitle: string | null,
): NoteAnchor {
  return { ...emptyAnchor("manual"), chapter_index: chapterIndex, chapter_title: chapterTitle };
}

/**
 * Pre-fill for the editor when a note is started from a reader (e.g. "note
 * this moment" while listening). Any field may be omitted.
 */
export interface NoteSeed {
  type?: NoteType;
  quote?: string;
  body?: string;
  color?: string | null;
  anchor?: NoteAnchor;
}

// ============================================================
// ACCESS
// ============================================================

function userBook(userId: string, bookId: string): string {
  return `${userId}_${bookId}`;
}

export interface NewNote {
  type: NoteType;
  body?: string;
  quote?: string;
  color?: string | null;
  starred?: boolean;
  /** For exercises: initial checkbox state. */
  done?: boolean | null;
  anchor: NoteAnchor;
}

/** Create a note. Returns the new document id. */
export async function createNote(
  userId: string,
  bookId: string,
  input: NewNote,
): Promise<string> {
  const isExercise = input.type === "exercise";
  const ref = await addDoc(collection(db, COL), {
    user_id: userId,
    book_id: bookId,
    user_book: userBook(userId, bookId),
    type: input.type,
    color: input.color ?? null,
    quote: input.quote ?? "",
    body: input.body ?? "",
    done: input.done ?? (isExercise ? false : null),
    starred: input.starred ?? false,
    anchor: input.anchor,
    // Date.now() keeps new notes after existing ones within a chapter until the
    // member reorders. Distinct from created_at (which uses a server stamp).
    order: Date.now(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

/** Patch a note. `updated_at` is always refreshed. */
export async function updateNote(
  noteId: string,
  patch: Partial<Omit<NoteDoc, "created_at">>,
): Promise<void> {
  await updateDoc(doc(db, COL, noteId), {
    ...patch,
    updated_at: serverTimestamp(),
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await deleteDoc(doc(db, COL, noteId));
}

export async function toggleNoteDone(noteId: string, done: boolean): Promise<void> {
  await updateNote(noteId, { done });
}

/** One-shot fetch of a book's notes for the signed-in member (e.g. export). */
export async function listBookNotes(
  userId: string,
  bookId: string,
): Promise<Note[]> {
  const snap = await getDocs(
    query(collection(db, COL), where("user_book", "==", userBook(userId, bookId))),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as NoteDoc) }));
}

/** Live subscription to a book's notes. Single equality filter → no composite
 *  index. Ordering is done client-side by the grouping helpers. */
export function watchBookNotes(
  userId: string,
  bookId: string,
  cb: (notes: Note[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL), where("user_book", "==", userBook(userId, bookId))),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as NoteDoc) }))),
  );
}

// ============================================================
// GROUPING & ORDERING (pure helpers)
// ============================================================

/** Sort key for two notes that share a chapter: manual order, then in-book
 *  position (page, paragraph), then creation time. */
function compareWithinChapter(a: Note, b: Note): number {
  if (a.order !== b.order) return a.order - b.order;
  const ap = a.anchor.page ?? Number.MAX_SAFE_INTEGER;
  const bp = b.anchor.page ?? Number.MAX_SAFE_INTEGER;
  if (ap !== bp) return ap - bp;
  const ai = a.anchor.paragraph_index ?? Number.MAX_SAFE_INTEGER;
  const bi = b.anchor.paragraph_index ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  const at = (a.created_at as Timestamp | undefined)?.toMillis?.() ?? 0;
  const bt = (b.created_at as Timestamp | undefined)?.toMillis?.() ?? 0;
  return at - bt;
}

export interface ChapterGroup {
  /** Chapter index, or null for the "Unfiled" group. */
  index: number | null;
  title: string;
  notes: Note[];
}

/**
 * Group notes by chapter, in reading order. The book's chapter map provides
 * titles and the ordering; chapters with no notes are omitted. Notes whose
 * chapter is null (front matter / no map) collect in a trailing "Unfiled"
 * group.
 */
export function groupNotesByChapter(
  notes: Note[],
  chapterMap: EpubChapterMapping[] | undefined,
): ChapterGroup[] {
  const titleFor = (index: number | null, fallback: string | null): string => {
    if (index == null) return "Unfiled";
    const fromMap = chapterMap?.find((c) => c.index === index)?.title;
    return fromMap ?? fallback ?? `Chapter ${index + 1}`;
  };

  const byIndex = new Map<number | null, Note[]>();
  for (const n of notes) {
    const key = n.anchor.chapter_index;
    const arr = byIndex.get(key) ?? [];
    arr.push(n);
    byIndex.set(key, arr);
  }

  const groups: ChapterGroup[] = [];
  for (const [index, arr] of byIndex) {
    arr.sort(compareWithinChapter);
    groups.push({ index, title: titleFor(index, arr[0]?.anchor.chapter_title ?? null), notes: arr });
  }

  // Real chapters ascending by index; the null ("Unfiled") group last.
  groups.sort((a, b) => {
    if (a.index == null) return 1;
    if (b.index == null) return -1;
    return a.index - b.index;
  });
  return groups;
}

export interface TypeGroup {
  type: NoteType;
  meta: NoteTypeMeta;
  notes: Note[];
}

/** Group notes by type, in catalog order; empty types omitted. */
export function groupNotesByType(notes: Note[]): TypeGroup[] {
  const byType = new Map<NoteType, Note[]>();
  for (const n of notes) {
    const arr = byType.get(n.type) ?? [];
    arr.push(n);
    byType.set(n.type, arr);
  }
  const groups: TypeGroup[] = [];
  for (const type of NOTE_TYPE_ORDER) {
    const arr = byType.get(type);
    if (!arr || arr.length === 0) continue;
    arr.sort(compareWithinChapter);
    groups.push({ type, meta: noteTypeMeta(type), notes: arr });
  }
  return groups;
}

export interface ChapterOption {
  index: number | null;
  title: string;
}

/** Chapter choices for the composer's chapter picker, plus an "Unfiled". */
export function chapterOptions(
  chapterMap: EpubChapterMapping[] | undefined,
): ChapterOption[] {
  const opts: ChapterOption[] = [{ index: null, title: "Unfiled" }];
  for (const c of [...(chapterMap ?? [])].sort((a, b) => a.index - b.index)) {
    opts.push({ index: c.index, title: c.title });
  }
  return opts;
}
