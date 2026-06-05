import type { EpubChapterMapping, Note } from "@/lib/types";

/**
 * Notebook completion model (Phase F).
 *
 * Two-stage, per chapter:
 *   - read-through .............. 50%
 *   - annotated (≥1 note) ....... 50%
 *   → a chapter is 100% only when it's both read AND annotated.
 *
 * Everything here is COMPUTED from data we already have (chapter map, live
 * notes, reading progress) — no extra Firestore docs or writes. Read-through
 * is inferred from the saved reading position: a chapter counts as read once
 * the furthest position has reached its end (the next chapter's start). We use
 * current_page when available (PDF) and fall back to current_percent (EPUB).
 */

export interface ChapterCompletion {
  index: number;
  title: string;
  startPage: number;
  endPage: number;
  read: boolean;
  annotated: boolean;
  noteCount: number;
  /** 0, 50, or 100. */
  percent: number;
}

export interface NotebookCompletion {
  chapters: ChapterCompletion[];
  totalChapters: number;
  readChapters: number;
  annotatedChapters: number;
  completedChapters: number;
  overallPercent: number;
}

export function computeCompletion(
  chapterMap: EpubChapterMapping[] | undefined,
  notes: Note[],
  progress: { current_page?: number | null; current_percent?: number | null } | null,
  pageCount: number | undefined,
): NotebookCompletion | null {
  if (!chapterMap || chapterMap.length === 0) return null;

  const sorted = [...chapterMap].sort((a, b) => a.index - b.index);
  const total = sorted.length;

  const noteCountByChapter = new Map<number, number>();
  for (const n of notes) {
    const ci = n.anchor.chapter_index;
    if (ci != null) {
      noteCountByChapter.set(ci, (noteCountByChapter.get(ci) ?? 0) + 1);
    }
  }

  const curPage = progress?.current_page ?? null;
  const curPct = progress?.current_percent ?? null;
  const lastStart = sorted[sorted.length - 1]?.source_page_start ?? 0;
  const pc = pageCount && pageCount > 0 ? pageCount : lastStart + 1;

  const chapters: ChapterCompletion[] = sorted.map((c, i) => {
    const startPage = c.source_page_start;
    const endPage =
      i < sorted.length - 1 ? sorted[i + 1].source_page_start - 1 : pc;

    let read = false;
    if (curPage != null && curPage > 0) {
      read = curPage >= endPage;
    } else if (curPct != null) {
      const endPct = pc > 0 ? (endPage / pc) * 100 : 100;
      read = curPct >= endPct - 0.5;
    }

    const noteCount = noteCountByChapter.get(c.index) ?? 0;
    const annotated = noteCount > 0;
    const percent = (read ? 50 : 0) + (annotated ? 50 : 0);

    return {
      index: c.index,
      title: c.title,
      startPage,
      endPage,
      read,
      annotated,
      noteCount,
      percent,
    };
  });

  const readChapters = chapters.filter((c) => c.read).length;
  const annotatedChapters = chapters.filter((c) => c.annotated).length;
  const completedChapters = chapters.filter((c) => c.read && c.annotated).length;
  const overallPercent =
    total > 0
      ? Math.round(chapters.reduce((s, c) => s + c.percent, 0) / total)
      : 0;

  return {
    chapters,
    totalChapters: total,
    readChapters,
    annotatedChapters,
    completedChapters,
    overallPercent,
  };
}
