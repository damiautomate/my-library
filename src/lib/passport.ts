import type { Book, ReadingProgressDoc } from "./types";
import { LIFE_DOMAINS, LIFE_STAGES, ROOMS } from "./taxonomy";

export interface PassportStats {
  // Headline numbers
  totalFinished: number;
  finishedThisYear: number;
  currentlyReading: number;
  totalPagesRead: number;
  totalHoursRead: number;
  // Streaks
  currentStreak: number;
  longestStreak: number;
  totalReadingDays: number;
  // Breakdowns — sorted by count desc, top N kept
  byRoom: Array<{ key: string; label: string; count: number }>;
  byDomain: Array<{ key: string; label: string; count: number }>;
  byStage: Array<{ key: string; label: string; count: number }>;
  topAuthors: Array<{ name: string; count: number }>;
  // Recent
  recentFinished: Array<{ book: Book; finishedAt?: Date }>;
}

const EMPTY_STATS: PassportStats = {
  totalFinished: 0,
  finishedThisYear: 0,
  currentlyReading: 0,
  totalPagesRead: 0,
  totalHoursRead: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalReadingDays: 0,
  byRoom: [],
  byDomain: [],
  byStage: [],
  topAuthors: [],
  recentFinished: [],
};

/**
 * `ymd` — local-time YYYY-MM-DD for a Date. We keep the user's calendar
 * notion of "today" rather than UTC because crossing midnight in UTC mid-
 * evening for African readers would break their visible streak.
 */
export function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localYmd(dt);
}

/**
 * Given a set of YYYY-MM-DD strings (stored in UTC), compute the current and
 * longest streaks. Each calendar day is mapped through the user's local TZ
 * before comparison so dates feel right to a reader in Lagos.
 *
 * Current streak = days ending on today OR yesterday (grace for late nights).
 */
export function computeStreaks(readingDays: string[] | undefined): {
  current: number;
  longest: number;
  total: number;
} {
  if (!readingDays || readingDays.length === 0) {
    return { current: 0, longest: 0, total: 0 };
  }

  // Convert stored UTC dates to local Y-M-D and dedupe. A UTC midnight
  // timestamp in Lagos (UTC+1) is still the previous day's evening locally,
  // so this conversion can shift the calendar bucket.
  const local = new Set<string>();
  for (const d of readingDays) {
    const dt = new Date(`${d}T12:00:00Z`); // noon UTC = same calendar day worldwide
    local.add(localYmd(dt));
  }
  const days = [...local].sort();

  // Longest streak: walk the sorted list, counting consecutive day-to-day jumps.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (addDays(days[i - 1], 1) === days[i]) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak: count back from today (or yesterday if today not in set).
  const today = localYmd(new Date());
  const yesterday = addDays(today, -1);
  let current = 0;
  let cursor = local.has(today) ? today : local.has(yesterday) ? yesterday : null;
  while (cursor && local.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest, total: local.size };
}

/** Top-N counter helper — sorts entries by count desc, returns first n. */
function topN<T extends { count: number }>(arr: T[], n: number): T[] {
  return arr.sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * Compute all passport stats. Pass a books map (id → Book) so we can look
 * up classification on each finished progress doc.
 */
export function computeStats(
  readingDays: string[] | undefined,
  progressDocs: ReadingProgressDoc[],
  books: Map<string, Book>,
): PassportStats {
  if (progressDocs.length === 0 && (!readingDays || readingDays.length === 0)) {
    return EMPTY_STATS;
  }

  const streaks = computeStreaks(readingDays);

  let totalFinished = 0;
  let finishedThisYear = 0;
  let currentlyReading = 0;
  let totalPagesRead = 0;
  let totalHoursRead = 0;

  const roomCounts: Record<string, number> = {};
  const domainCounts: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  const authorCounts: Record<string, number> = {};
  const recents: Array<{ book: Book; finishedAt?: Date }> = [];

  const now = new Date();
  const thisYear = now.getFullYear();

  for (const p of progressDocs) {
    if (p.status === "currently_reading") currentlyReading += 1;
    if (p.status !== "finished") continue;

    totalFinished += 1;

    const finishedDate = (p.finished_at as { toDate?: () => Date } | undefined)?.toDate?.();
    if (finishedDate && finishedDate.getFullYear() === thisYear) {
      finishedThisYear += 1;
    }

    const b = books.get(p.book_id);
    if (!b) continue;

    if (b.page_count) totalPagesRead += b.page_count;
    if (b.estimated_reading_time_hours) totalHoursRead += b.estimated_reading_time_hours;

    for (const r of b.rooms ?? []) roomCounts[r] = (roomCounts[r] ?? 0) + 1;
    for (const d of b.life_domains ?? [])
      domainCounts[d] = (domainCounts[d] ?? 0) + 1;
    for (const s of b.life_stages ?? [])
      stageCounts[s] = (stageCounts[s] ?? 0) + 1;
    for (const a of b.authors ?? [])
      authorCounts[a] = (authorCounts[a] ?? 0) + 1;

    recents.push({ book: b, finishedAt: finishedDate });
  }

  // Recent finished — newest first
  recents.sort((a, b) => {
    const at = a.finishedAt?.getTime() ?? 0;
    const bt = b.finishedAt?.getTime() ?? 0;
    return bt - at;
  });

  return {
    totalFinished,
    finishedThisYear,
    currentlyReading,
    totalPagesRead,
    totalHoursRead,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    totalReadingDays: streaks.total,
    byRoom: topN(
      Object.entries(roomCounts).map(([key, count]) => ({
        key,
        label: ROOMS[key as keyof typeof ROOMS]?.label ?? key,
        count,
      })),
      5,
    ),
    byDomain: topN(
      Object.entries(domainCounts).map(([key, count]) => ({
        key,
        label: LIFE_DOMAINS[key as keyof typeof LIFE_DOMAINS] ?? key,
        count,
      })),
      6,
    ),
    byStage: topN(
      Object.entries(stageCounts).map(([key, count]) => ({
        key,
        label: LIFE_STAGES[key as keyof typeof LIFE_STAGES] ?? key,
        count,
      })),
      5,
    ),
    topAuthors: topN(
      Object.entries(authorCounts).map(([name, count]) => ({ name, count })),
      6,
    ),
    recentFinished: recents.slice(0, 5),
  };
}

/**
 * Build a calendar matrix for the last `weeks` weeks. Each cell carries a
 * date and whether the user read on that day. Used by the contribution-style
 * calendar in the passport.
 */
export function buildCalendar(
  readingDays: string[] | undefined,
  weeks = 26,
): { date: string; read: boolean }[][] {
  const set = new Set<string>();
  for (const d of readingDays ?? []) {
    const dt = new Date(`${d}T12:00:00Z`);
    set.add(localYmd(dt));
  }

  const today = new Date();
  const totalDays = weeks * 7;
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));

  const cells: { date: string; read: boolean }[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ymd = localYmd(d);
    cells.push({ date: ymd, read: set.has(ymd) });
  }

  // Group into weeks of 7 from the END (so the latest week is rightmost)
  const grid: { date: string; read: boolean }[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    grid.push(cells.slice(i, i + 7));
  }
  return grid;
}
