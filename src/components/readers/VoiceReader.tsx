"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pause,
  Play,
  Rewind,
  FastForward,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { makeDebouncedSaver, saveProgress } from "@/lib/progress";
import type { VoiceSegment, EpubChapterMapping } from "@/lib/types";
import { chapterForPage } from "@/lib/chapters";

/**
 * Currently-narrating paragraph info. The PDF/EPUB readers use this to
 * highlight the right paragraph in real-time as audio plays.
 *   - page: which source-PDF page this paragraph is on (matches data-source-page)
 *   - paragraphIndex: 0-based position within that page's paragraphs
 *     (matches data-page-paragraph-index)
 *   - text: a truncated snippet of the paragraph (used by PDFReader to find
 *     matching spans in the rendered PDF text layer)
 */
export interface NarratingParagraph {
  page: number;
  paragraphIndex: number;
  text: string;
  /** First ~60 chars of the NEXT distinct paragraph after this one (across
   * sub-marks and across pages). PDFReader uses this as a hard stop boundary
   * for the highlight — finding where N+1 starts in the text layer tells us
   * exactly where N ends, which is far more reliable than trying to match
   * the end of N's own text against the rendered spans. Null only when this
   * is the very last paragraph of the segment. Phase 9p. */
  nextText: string | null;
  /** True when the next paragraph is on the SAME source page as this one.
   * When false (next is on a later page, OR there is no next), the highlight
   * should extend to the end of the rendered text layer for this page. */
  nextIsSamePage: boolean;
}

/**
 * Imperative control handle exposed to the parent via the onControlsReady
 * callback prop. Lets sibling readers (PDFReader, EPUBReader) drive playback
 * — e.g. a mini play/pause button in the PDF toolbar while audio plays
 * in the background. We use a callback registry instead of forwardRef
 * because next/dynamic doesn't propagate refs through its wrapper.
 */
export interface VoiceReaderHandle {
  togglePlay: () => Promise<void>;
  nudgeBackward: (seconds: number) => void;
  nudgeForward: (seconds: number) => void;
  isPlaying: () => boolean;
  /** Start narration from the top of a given source page (tap-to-play). */
  playFromPage: (page: number) => Promise<void>;
  /** Jump to the previous (-1) or next (+1) distinct paragraph. */
  stepParagraph: (dir: 1 | -1) => void;
}

interface VoiceReaderProps {
  segments: VoiceSegment[];
  userId: string;
  bookId: string;
  /** Initial page to start narration from (matches PDF/EPUB current_page). */
  initialPage?: number;
  /** Total source-PDF page count, for percent calculations. */
  totalPages?: number;
  /** Page set externally (e.g. user advanced in PDF tab). When this changes
   * AND the voice reader is currently hidden (i.e. user is on PDF/EPUB), we
   * realign the playback segment to match. We never realign while voice is
   * the active tab — that would interrupt listening. */
  externalPage?: number | null;
  /** Exact segment index to resume from. Takes precedence over initialPage —
   * if set, we restore to this segment regardless of where initialPage maps. */
  initialSegmentIndex?: number;
  /** Exact seconds within initialSegmentIndex to seek to on first audio load.
   * This is the key field for precise pause/resume — without it, the audio
   * always starts at the beginning of the segment. */
  initialSeconds?: number;
  onPercentChange?: (pct: number) => void;
  /** Called as voice narration advances through pages. Also fires when the
   * user manually skips/scrubs. Used for cross-tab progress sync. */
  onPageChange?: (page: number) => void;
  /** Like onPageChange but ONLY fires when audio is actively playing — gives
   * the EPUB reader a current-narration target for paragraph highlighting,
   * and clears (passes null) when playback pauses/ends so the highlight is
   * removed. */
  onNarratingPage?: (page: number | null) => void;
  /** Fires when narration crosses paragraph boundaries (estimated by char
   * weight against segment duration). Null when not playing or no paragraph
   * data on the segment (older voice generations). */
  onNarratingParagraph?: (info: NarratingParagraph | null) => void;
  /** Fires whenever play/pause state changes — lets the parent show a
   * "playing" indicator + enable/disable mini-player controls elsewhere. */
  onPlayingChange?: (playing: boolean) => void;
  /** Called once on mount with an imperative control handle, and again with
   * null on unmount. The parent stores the handle in a ref and passes
   * bound callbacks to sibling readers (e.g. PDF toolbar mini-player). This
   * is a callback-based alternative to forwardRef because next/dynamic
   * doesn't forward refs through its wrapper. */
  onControlsReady?: (handle: VoiceReaderHandle | null) => void;
  /** Chapter map (from epub_chapter_map) for the "now reading: Ch. X" label
   * and lock-screen metadata (Phase 9t). Optional — falls back to a page
   * label when absent. */
  chapterMap?: EpubChapterMapping[];
  /** Book title — shown on the lock-screen / notification via MediaSession. */
  bookTitle?: string;
  /** Book authors — shown as the "artist" in lock-screen metadata. */
  bookAuthors?: string[];
  /** Cover image URL — shown as artwork on the lock-screen / notification. */
  coverUrl?: string;
}

const NUDGE_SECONDS = 10;

/**
 * Given a segment, the audio position within it, and the per-page paragraph
 * data, return which paragraph is most likely being narrated right now.
 *
 * We model the segment as a sequence of paragraphs across pages and assume
 * narration speed is roughly proportional to character count — longer
 * paragraphs take longer to read aloud. Each paragraph gets a time slice
 * proportional to its char share of the segment total. Without SSML
 * timepoints this is approximate but close enough for highlighting.
 */
/**
 * Estimate how much "speech time" a paragraph takes — LEGACY FALLBACK only.
 * Used for voice segments generated before SSML mark timepoints existed.
 * For new segments, paragraph_timepoints gives us exact timing from Google's
 * response, so this approximation isn't used.
 */
function paragraphWeight(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const sentenceEnds = (text.match(/[.!?](?=\s|$)/g) || []).length;
  return Math.max(1, words + sentenceEnds * 6);
}

/**
 * Parse a markName back into (page, paragraphIndex). The format is
 * `p{page}-{paragraphIndex}` for normal paragraphs, or
 * `p{page}-{paragraphIndex}.{subIndex}` for sub-chunks of an over-long
 * paragraph that had to be split across multiple SSML requests. Both forms
 * resolve to the same (page, paragraphIndex) — sub-chunks are invisible at
 * the highlight layer; they exist only so the audio can flow through long
 * paragraphs without bumping into Google's per-request size limit.
 *
 * Returns null for unrecognized formats (defensive — should never happen
 * for marks we generated, but Firestore data is untrusted).
 */
function parseMarkName(
  markName: string,
): { page: number; paragraphIndex: number } | null {
  const m = markName.match(/^p(\d+)-(\d+)(?:\.\d+)?$/);
  if (!m) return null;
  return {
    page: parseInt(m[1], 10),
    paragraphIndex: parseInt(m[2], 10),
  };
}

/**
 * Look up the currently-narrated paragraph for `position` seconds into the
 * given segment. Uses the segment's recorded SSML mark timepoints when
 * present (precise to ~10ms), otherwise falls back to word-and-sentence
 * weighting (approximate, can drift several seconds over a long segment).
 *
 * Also returns the FIRST 60 chars of the next distinct paragraph plus a
 * flag for whether it's on the same source page — the PDF highlight matcher
 * uses this as a stop boundary so the highlight doesn't undershoot on long
 * paragraphs (Phase 9p).
 */
function findCurrentParagraph(
  segment: VoiceSegment,
  position: number,
): NarratingParagraph | null {
  // Look up paragraph text from pages_paragraphs given a parsed markName.
  const lookupText = (
    parsed: { page: number; paragraphIndex: number },
  ): string => {
    const pageBucket = segment.pages_paragraphs?.find(
      (p) => p.page === parsed.page,
    );
    return pageBucket?.paragraphs[parsed.paragraphIndex] ?? "";
  };

  // ---- Preferred path: use exact SSML timepoints ----
  const tps = segment.paragraph_timepoints;
  if (tps && tps.length > 0) {
    // Binary search for the largest timepoint with time <= position.
    let lo = 0;
    let hi = tps.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (tps[mid].time <= position) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 0) return null; // Before the first mark — silence/intro
    const tp = tps[best];
    const parsed = parseMarkName(tp.markName);
    if (!parsed) return null;
    const text = lookupText(parsed);
    if (!text) return null;

    // Scan forward for the NEXT distinct paragraph (skip sub-marks, which
    // share parsed.paragraphIndex). We need its leading text so the PDF
    // matcher can find a hard end-boundary for our highlight.
    let nextText: string | null = null;
    let nextIsSamePage = false;
    for (let i = best + 1; i < tps.length; i++) {
      const np = parseMarkName(tps[i].markName);
      if (!np) continue;
      if (np.page === parsed.page && np.paragraphIndex === parsed.paragraphIndex) {
        continue; // sub-mark of current paragraph
      }
      const nt = lookupText(np);
      if (!nt) continue;
      nextText = nt.slice(0, Math.min(60, nt.length));
      nextIsSamePage = np.page === parsed.page;
      break;
    }

    return {
      page: parsed.page,
      paragraphIndex: parsed.paragraphIndex,
      text,
      nextText,
      nextIsSamePage,
    };
  }

  // ---- Legacy fallback for segments without timepoints ----
  if (!segment.pages_paragraphs || segment.pages_paragraphs.length === 0)
    return null;
  const all: Array<{ page: number; index: number; text: string }> = [];
  for (const pg of segment.pages_paragraphs) {
    pg.paragraphs.forEach((text, idx) => {
      if (text.trim().length > 0) {
        all.push({ page: pg.page, index: idx, text });
      }
    });
  }
  if (all.length === 0) return null;
  const dur = segment.duration > 0 ? segment.duration : 1;
  const totalWeight = all.reduce((s, p) => s + paragraphWeight(p.text), 0);
  let cumWeight = 0;
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const w = paragraphWeight(p.text);
    const endTime = ((cumWeight + w) / totalWeight) * dur;
    if (position < endTime) {
      const next = all[i + 1];
      return {
        page: p.page,
        paragraphIndex: p.index,
        text: p.text,
        nextText: next ? next.text.slice(0, 60) : null,
        nextIsSamePage: next ? next.page === p.page : false,
      };
    }
    cumWeight += w;
  }
  const last = all[all.length - 1];
  return {
    page: last.page,
    paragraphIndex: last.index,
    text: last.text,
    nextText: null,
    nextIsSamePage: false,
  };
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    // H:MM:SS — e.g. "2:14:23" for a long book's total duration
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  // M:SS — e.g. "3:45" for shorter durations
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Pick the segment that covers a given source-PDF page. If the page falls
 * outside any segment (rare — usually means the page is in the front matter
 * before generation started or back matter after), default to segment 0.
 */
function segmentForPage(segments: VoiceSegment[], page: number): number {
  for (let i = 0; i < segments.length; i++) {
    if (page >= segments[i].page_start && page <= segments[i].page_end) return i;
  }
  // If page is beyond the last segment, return the last segment
  if (segments.length > 0 && page > segments[segments.length - 1].page_end) {
    return segments.length - 1;
  }
  return 0;
}

/**
 * Distinct paragraph start times within a segment, derived from SSML mark
 * timepoints. Sub-marks of the same paragraph collapse to one entry. Used for
 * paragraph-by-paragraph stepping. Empty for legacy segments without marks.
 */
function distinctParagraphStarts(
  segment: VoiceSegment,
): Array<{ time: number; page: number; paragraphIndex: number }> {
  const tps = segment.paragraph_timepoints;
  if (!tps || tps.length === 0) return [];
  const out: Array<{ time: number; page: number; paragraphIndex: number }> = [];
  let lastKey = "";
  for (const tp of tps) {
    const p = parseMarkName(tp.markName);
    if (!p) continue;
    const key = `${p.page}-${p.paragraphIndex}`;
    if (key === lastKey) continue;
    lastKey = key;
    out.push({ time: tp.time, page: p.page, paragraphIndex: p.paragraphIndex });
  }
  return out;
}

/** Time (seconds) where a source page's narration begins within a segment. */
function pageStartTime(segment: VoiceSegment, page: number): number {
  const tps = segment.paragraph_timepoints;
  if (tps && tps.length > 0) {
    for (const tp of tps) {
      const p = parseMarkName(tp.markName);
      if (p && p.page === page) return tp.time;
    }
  }
  return 0;
}

export function VoiceReader({
  segments,
  userId,
  bookId,
  initialPage = 1,
  totalPages,
  externalPage,
  initialSegmentIndex,
  initialSeconds,
  onPercentChange,
  onPageChange,
  onNarratingPage,
  onNarratingParagraph,
  onPlayingChange,
  onControlsReady,
  chapterMap,
  bookTitle,
  bookAuthors,
  coverUrl,
}: VoiceReaderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  // Resolve the starting segment. If we have a saved exact segment index,
  // trust it (so audio resumes precisely). Otherwise compute from initialPage,
  // which is the cross-tab-sync fallback.
  const startSeg = useMemo(() => {
    if (
      initialSegmentIndex !== undefined &&
      initialSegmentIndex >= 0 &&
      initialSegmentIndex < segments.length
    ) {
      return initialSegmentIndex;
    }
    return segmentForPage(segments, initialPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // freeze at mount — never re-resolve

  const [segIdx, setSegIdx] = useState(startSeg);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(initialSeconds ?? 0);
  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // The first time the audio element loads metadata for our starting segment,
  // we seek it to initialSeconds. Tracked via ref so subsequent segment
  // changes don't try to seek (they should start at 0). This is the key fix
  // for "audio resumes at the start of the segment instead of exact pause".
  const initialSeekRef = useRef<number | null>(
    initialSeconds && initialSeconds > 0 ? initialSeconds : null,
  );

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1500),
    [userId, bookId],
  );

  const current = segments[segIdx];
  const totalDuration = useMemo(
    () => segments.reduce((s, seg) => s + (seg.duration || 0), 0),
    [segments],
  );
  const elapsedBefore = useMemo(
    () =>
      segments
        .slice(0, segIdx)
        .reduce((s, seg) => s + (seg.duration || 0), 0),
    [segments, segIdx],
  );
  const totalElapsed = elapsedBefore + position;

  /**
   * The paragraph the audio is CURRENTLY narrating, computed from the segment's
   * SSML mark timepoints (precise to ~10ms when timepoints exist) or from
   * word/sentence weighting as a fallback for legacy segments. We memoize this
   * because it's used by TWO downstream consumers — `currentPage` below for
   * PDF auto-follow, and the broadcast effect for PDF/EPUB paragraph
   * highlighting — and we want both fed by the same source of truth so they
   * can never disagree (which would manifest as the PDF flipping ahead while
   * the highlight is still on the previous page).
   */
  const currentParagraph = useMemo(() => {
    if (!current) return null;
    return findCurrentParagraph(current, position);
  }, [current, position]);

  /**
   * The PDF page the audio is currently narrating.
   *
   * PREFERRED: derive from `currentParagraph.page` when timepoints are
   * available. This makes the PDF follower exactly track the audio — when
   * the narration moves from page 41 to page 42, the page indicator flips
   * at the same moment, not when linear interpolation guesses.
   *
   * FALLBACK: linear interpolation across the segment's page range, used
   * for old voice segments that were generated before SSML timepoints
   * existed. This is the original imperfect behavior (assumes each page
   * takes equal time, which it doesn't), but it's better than nothing for
   * legacy data.
   */
  const currentPage = useMemo(() => {
    if (currentParagraph) return currentParagraph.page;
    if (!current) return initialPage;
    const segProgress = current.duration > 0 ? position / current.duration : 0;
    const pageSpan = current.page_end - current.page_start + 1;
    return Math.min(
      current.page_end,
      current.page_start + Math.floor(segProgress * pageSpan),
    );
  }, [currentParagraph, current, position, initialPage]);

  // Current chapter for the header label + lock-screen metadata (Phase 9t).
  // Recomputed as the narrated page advances; null for books without a
  // chapter map or while in front matter before the first chapter.
  const currentChapter = useMemo(
    () => chapterForPage(chapterMap, currentPage),
    [chapterMap, currentPage],
  );

  // Persist progress with the page tracking convention shared by PDF/EPUB.
  // We persist FOUR fields here:
  //   - current_page / current_percent  → cross-tab sync (PDF/EPUB use these)
  //   - current_voice_segment_index / current_voice_seconds → exact restore
  // The audio fields are what let us resume at the precise pause point. The
  // page fields are an approximation good enough for "what page are we on?"
  useEffect(() => {
    if (!current) return;
    const pct =
      totalPages && totalPages > 1
        ? Math.round(((currentPage - 1) / (totalPages - 1)) * 100)
        : totalDuration > 0
          ? Math.round((totalElapsed / totalDuration) * 100)
          : 0;
    onPercentChange?.(pct);
    onPageChange?.(currentPage);
    saver.save({
      current_page: currentPage,
      current_percent: pct,
      current_voice_segment_index: segIdx,
      current_voice_seconds: position,
    });
  }, [currentPage, totalElapsed, totalDuration, totalPages, segIdx, position, onPercentChange, onPageChange, saver, current]);

  // Tell external readers (EPUB) when audio is actively playing AND what page
  // is being narrated. Clearing on pause removes any "follow along" highlight
  // they might be showing.
  useEffect(() => {
    if (playing && current) {
      onNarratingPage?.(currentPage);
    } else {
      onNarratingPage?.(null);
    }
  }, [playing, currentPage, current, onNarratingPage]);

  // React to external page updates: when the user advances pages in the PDF
  // or EPUB tab, externalPage updates. We realign to the matching audio
  // segment ONLY while paused — so we never interrupt active listening.
  useEffect(() => {
    if (externalPage == null) return;
    if (playing) return; // never interrupt playback
    if (!current) return;
    // If the new page is already within the current segment's range, no realign
    if (externalPage >= current.page_start && externalPage <= current.page_end) {
      return;
    }
    const newIdx = segmentForPage(segments, externalPage);
    if (newIdx !== segIdx) setSegIdx(newIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPage]);

  // Cleanup pending saves on unmount
  useEffect(() => {
    return () => {
      void saver.flush();
    };
  }, [saver]);

  // Protect against tab-close mid-playback. We use sendBeacon via the native
  // `beforeunload` event because the debounced saver might still be waiting
  // and fetch() during page unload is unreliable. saveProgress writes to
  // Firestore directly — if the browser allows the request to complete in
  // the unload window, the user's exact position is captured.
  useEffect(() => {
    const handler = () => {
      const el = audioRef.current;
      if (!el) return;
      // Fire-and-forget; can't await during unload
      void saveProgress(userId, bookId, {
        current_voice_segment_index: segIdx,
        current_voice_seconds: el.currentTime,
        current_page: currentPage,
      });
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
  }, [userId, bookId, segIdx, currentPage]);

  // Set up audio element on segment change. On the very FIRST segment load
  // (initial mount), we seek to initialSeconds — this is what makes audio
  // resume precisely where the user paused last session. On subsequent
  // segment changes (user clicks next, or auto-advance), we start at 0.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    el.src = current.url;
    el.playbackRate = rate;

    const seekTo = initialSeekRef.current;
    if (seekTo !== null && seekTo > 0) {
      // We have an initial restore target. Seek on loadedmetadata so the
      // duration is known and the seek is valid.
      const onLoaded = () => {
        try {
          el.currentTime = seekTo;
          setPosition(seekTo);
        } catch {}
        initialSeekRef.current = null; // only seek once
        el.removeEventListener("loadedmetadata", onLoaded);
      };
      el.addEventListener("loadedmetadata", onLoaded);
    } else {
      setPosition(0);
    }

    setError(null);
    if (playing) {
      el.play().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segIdx]);

  // Apply rate changes live
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      // CRITICAL: on pause, write the exact position synchronously to
      // Firestore. If we relied on the debounced saver, a user pausing and
      // immediately closing the tab would lose 1.5s of progress and resume at
      // the wrong spot. The saver merges this into pending state and flush()
      // forces an immediate Firestore write.
      saver.save({
        current_voice_segment_index: segIdx,
        current_voice_seconds: el.currentTime,
        current_page: currentPage,
      });
      try {
        await saver.flush();
      } catch (err) {
        console.warn("[voice] pause-save failed", err);
      }
    } else {
      setLoading(true);
      try {
        await el.play();
        setPlaying(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
  }, [playing, segIdx, currentPage, saver]);

  /**
   * Nudge audio position by N seconds within the current segment. If the
   * resulting position would cross a segment boundary, we transition to the
   * adjacent segment instead (preserving the "extra" time as the position in
   * the new segment, so 5s into seg 3 - 10s = -5s = 5s before the end of seg 2).
   */
  const nudgeBackward = useCallback(
    (seconds: number) => {
      const el = audioRef.current;
      if (!el || !current) return;
      const newPos = el.currentTime - seconds;
      if (newPos >= 0) {
        el.currentTime = newPos;
        setPosition(newPos);
        // Immediate save so refresh-during-pause never re-anchors backward
        saver.save({
          current_voice_segment_index: segIdx,
          current_voice_seconds: newPos,
        });
        void saver.flush();
      } else if (segIdx > 0) {
        // Cross boundary backward: jump to end of previous segment minus overflow
        const prevSeg = segments[segIdx - 1];
        const targetPos = Math.max(0, (prevSeg.duration || 0) + newPos);
        initialSeekRef.current = targetPos; // restore-on-load mechanism
        setSegIdx(segIdx - 1);
        saver.save({
          current_voice_segment_index: segIdx - 1,
          current_voice_seconds: targetPos,
        });
        void saver.flush();
      } else {
        // Already at the very beginning
        el.currentTime = 0;
        setPosition(0);
      }
    },
    [current, segIdx, segments, saver],
  );

  const nudgeForward = useCallback(
    (seconds: number) => {
      const el = audioRef.current;
      if (!el || !current) return;
      const dur = current.duration || el.duration || 0;
      const newPos = el.currentTime + seconds;
      if (newPos <= dur || dur === 0) {
        el.currentTime = newPos;
        setPosition(newPos);
        saver.save({
          current_voice_segment_index: segIdx,
          current_voice_seconds: newPos,
        });
        void saver.flush();
      } else if (segIdx < segments.length - 1) {
        // Cross boundary forward
        const overflow = newPos - dur;
        initialSeekRef.current = overflow;
        setSegIdx(segIdx + 1);
        saver.save({
          current_voice_segment_index: segIdx + 1,
          current_voice_seconds: overflow,
        });
        void saver.flush();
      } else {
        // At end of last segment
        el.currentTime = dur;
        setPosition(dur);
      }
    },
    [current, segIdx, segments, saver],
  );

  /**
   * Start narration from the top of a given source page. Used by tap-to-play
   * in the PDF reader. If the page lives in the current segment we just seek;
   * otherwise we switch segments (auto-playing once loaded).
   */
  const playFromPage = useCallback(
    async (targetPage: number) => {
      const idx = segmentForPage(segments, targetPage);
      const seg = segments[idx];
      if (!seg) return;
      const startTime = pageStartTime(seg, targetPage);
      const el = audioRef.current;
      if (idx === segIdx && el) {
        try {
          el.currentTime = startTime;
        } catch {}
        setPosition(startTime);
        saver.save({
          current_voice_segment_index: idx,
          current_voice_seconds: startTime,
        });
        void saver.flush();
        setLoading(true);
        try {
          await el.play();
          setPlaying(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setLoading(false);
        }
      } else {
        // Different segment: arm the restore-on-load seek and flip to it. The
        // segment-change effect plays automatically because we set playing.
        initialSeekRef.current = startTime;
        setPlaying(true);
        setSegIdx(idx);
        saver.save({
          current_voice_segment_index: idx,
          current_voice_seconds: startTime,
        });
        void saver.flush();
      }
    },
    [segments, segIdx, saver],
  );

  /**
   * Jump to the previous/next distinct paragraph using SSML mark timepoints.
   * Backward within ~1.5s of a paragraph's start goes to the previous one;
   * otherwise it restarts the current paragraph (mirrors skip-back feel).
   * Falls back to a 15s nudge for legacy segments without timepoints.
   */
  const stepParagraph = useCallback(
    (dir: 1 | -1) => {
      const el = audioRef.current;
      if (!el || !current) return;
      const starts = distinctParagraphStarts(current);
      if (starts.length === 0) {
        if (dir > 0) nudgeForward(15);
        else nudgeBackward(15);
        return;
      }
      const seekWithin = (t: number) => {
        try {
          el.currentTime = t;
        } catch {}
        setPosition(t);
        saver.save({
          current_voice_segment_index: segIdx,
          current_voice_seconds: t,
        });
        void saver.flush();
      };
      const pos = el.currentTime;
      let cur = 0;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i].time <= pos + 0.05) cur = i;
        else break;
      }
      if (dir > 0) {
        if (cur < starts.length - 1) {
          seekWithin(starts[cur + 1].time);
        } else if (segIdx < segments.length - 1) {
          initialSeekRef.current = 0;
          setSegIdx(segIdx + 1);
          saver.save({
            current_voice_segment_index: segIdx + 1,
            current_voice_seconds: 0,
          });
          void saver.flush();
        }
      } else {
        const curStart = starts[cur].time;
        if (pos - curStart > 1.5) {
          seekWithin(curStart);
        } else if (cur > 0) {
          seekWithin(starts[cur - 1].time);
        } else if (segIdx > 0) {
          const prevSeg = segments[segIdx - 1];
          const target = Math.max(0, (prevSeg.duration || 0) - 1);
          initialSeekRef.current = target;
          setSegIdx(segIdx - 1);
          saver.save({
            current_voice_segment_index: segIdx - 1,
            current_voice_seconds: target,
          });
          void saver.flush();
        } else {
          seekWithin(0);
        }
      }
    },
    [current, segIdx, segments, saver, nudgeForward, nudgeBackward],
  );

  // Stable refs to the latest fn versions — used by the imperative handle so
  // the parent gets a stable callback identity that always calls through to
  // the current closure. Without this, the parent would re-receive the
  // handle on every render (every useCallback dep change) and have to
  // re-bind props on PDFReader, causing unnecessary work.
  const togglePlayLatestRef = useRef(togglePlay);
  const nudgeBackwardLatestRef = useRef(nudgeBackward);
  const nudgeForwardLatestRef = useRef(nudgeForward);
  const playFromPageLatestRef = useRef(playFromPage);
  const stepParagraphLatestRef = useRef(stepParagraph);
  const playingLatestRef = useRef(playing);
  useEffect(() => {
    togglePlayLatestRef.current = togglePlay;
  }, [togglePlay]);
  useEffect(() => {
    nudgeBackwardLatestRef.current = nudgeBackward;
  }, [nudgeBackward]);
  useEffect(() => {
    nudgeForwardLatestRef.current = nudgeForward;
  }, [nudgeForward]);
  useEffect(() => {
    playFromPageLatestRef.current = playFromPage;
  }, [playFromPage]);
  useEffect(() => {
    stepParagraphLatestRef.current = stepParagraph;
  }, [stepParagraph]);
  useEffect(() => {
    playingLatestRef.current = playing;
  }, [playing]);

  // Hand a stable control handle to the parent ONCE per onControlsReady
  // identity. The parent should pass a stable callback (e.g. via useCallback).
  useEffect(() => {
    if (!onControlsReady) return;
    const handle: VoiceReaderHandle = {
      togglePlay: () => togglePlayLatestRef.current(),
      nudgeBackward: (s) => nudgeBackwardLatestRef.current(s),
      nudgeForward: (s) => nudgeForwardLatestRef.current(s),
      isPlaying: () => playingLatestRef.current,
      playFromPage: (p) => playFromPageLatestRef.current(p),
      stepParagraph: (d) => stepParagraphLatestRef.current(d),
    };
    onControlsReady(handle);
    return () => onControlsReady(null);
  }, [onControlsReady]);

  // Broadcast playing state so the parent can show a "Voice playing" badge
  // and enable/disable the PDF-tab mini-player accordingly.
  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  // Broadcast the currently-narrated paragraph (page + index + text snippet)
  // to PDF/EPUB readers for highlighting. Fires only while playing — on pause
  // we send null so highlights clear.
  //
  // Source: the memoized `currentParagraph` above, which uses SSML timepoints
  // when available. The timeupdate event fires ~4×/sec but the paragraph only
  // changes every few seconds; we compare against the last broadcast value so
  // downstream readers don't re-render on no-op updates.
  const lastBroadcastParagraphRef = useRef<NarratingParagraph | null>(null);
  useEffect(() => {
    if (!playing || !current) {
      if (lastBroadcastParagraphRef.current !== null) {
        lastBroadcastParagraphRef.current = null;
        onNarratingParagraph?.(null);
      }
      return;
    }
    const para = currentParagraph;
    const last = lastBroadcastParagraphRef.current;
    if (
      para?.page === last?.page &&
      para?.paragraphIndex === last?.paragraphIndex
    ) {
      // Same paragraph as last broadcast — skip
      return;
    }
    lastBroadcastParagraphRef.current = para;
    onNarratingParagraph?.(para);
  }, [playing, current, currentParagraph, onNarratingParagraph]);

  const skipForward = useCallback(() => {
    if (segIdx < segments.length - 1) {
      const next = segIdx + 1;
      setSegIdx(next);
      saver.save({
        current_voice_segment_index: next,
        current_voice_seconds: 0,
      });
      void saver.flush();
    }
  }, [segIdx, segments.length, saver]);

  const skipBack = useCallback(() => {
    if (position > 3) {
      // If we're more than 3s in, jump to start of current segment
      const el = audioRef.current;
      if (el) {
        el.currentTime = 0;
        setPosition(0);
        saver.save({
          current_voice_segment_index: segIdx,
          current_voice_seconds: 0,
        });
        void saver.flush();
      }
    } else if (segIdx > 0) {
      const prev = segIdx - 1;
      setSegIdx(prev);
      saver.save({
        current_voice_segment_index: prev,
        current_voice_seconds: 0,
      });
      void saver.flush();
    }
  }, [segIdx, position, saver]);

  // ---- MediaSession: lock-screen / notification metadata + controls (9t) --
  //
  // Wires the OS media UI (Android notification, iOS lock screen, desktop
  // media keys) to this reader. Shows the book cover, the current chapter as
  // the "track" title, and the book title as the album. Action handlers map
  // the hardware/notification buttons to our existing playback controls so
  // the user can pause or skip without returning to the tab.
  //
  // Metadata updates whenever the chapter changes (so the notification tracks
  // chapter transitions during playback) or the book identity changes.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: currentChapter?.title || bookTitle || "Narration",
        artist: bookAuthors?.join(", ") || "",
        album: bookTitle || "",
        artwork: coverUrl
          ? [
              { src: coverUrl, sizes: "256x256", type: "image/jpeg" },
              { src: coverUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      // MediaMetadata constructor can throw on some older browsers — ignore.
    }
  }, [currentChapter, bookTitle, bookAuthors, coverUrl]);

  // Bind action handlers once. They call latest-ref versions so we don't churn
  // handlers on every render (the underlying callbacks are memoized but their
  // identities change as deps change).
  const skipForwardRef = useRef(skipForward);
  const skipBackRef = useRef(skipBack);
  skipForwardRef.current = skipForward;
  skipBackRef.current = skipBack;
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    const ms = navigator.mediaSession;
    const set = (
      action: MediaSessionAction,
      handler: (() => void) | null,
    ) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Some actions aren't supported on all browsers — ignore.
      }
    };
    set("play", () => void togglePlayLatestRef.current());
    set("pause", () => void togglePlayLatestRef.current());
    set("seekbackward", () => nudgeBackwardLatestRef.current(NUDGE_SECONDS));
    set("seekforward", () => nudgeForwardLatestRef.current(NUDGE_SECONDS));
    set("previoustrack", () => skipBackRef.current());
    set("nexttrack", () => skipForwardRef.current());
    return () => {
      // Clear on unmount so a stale reader doesn't keep controlling the OS UI.
      for (const a of [
        "play",
        "pause",
        "seekbackward",
        "seekforward",
        "previoustrack",
        "nexttrack",
      ] as MediaSessionAction[]) {
        set(a, null);
      }
    };
  }, []);

  // Keep the OS playback-state indicator in sync (play/pause glyph).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);
  function handleEnded() {
    if (segIdx < segments.length - 1) {
      const next = segIdx + 1;
      setSegIdx(next);
      // Persist the segment transition immediately so even a crash here
      // doesn't roll us back
      saver.save({
        current_voice_segment_index: next,
        current_voice_seconds: 0,
      });
      void saver.flush();
    } else {
      setPlaying(false);
    }
  }

  function handleTimeUpdate() {
    if (audioRef.current) setPosition(audioRef.current.currentTime);
  }

  function handleSegmentSeek(targetSec: number) {
    // Find which segment contains this absolute time, then seek within it
    let remaining = targetSec;
    for (let i = 0; i < segments.length; i++) {
      const d = segments[i].duration || 0;
      if (remaining <= d) {
        if (i !== segIdx) {
          setSegIdx(i);
          // Position will be set after the segment-change useEffect runs;
          // we need to defer the actual seek until then.
          requestAnimationFrame(() => {
            if (audioRef.current) {
              audioRef.current.currentTime = remaining;
              setPosition(remaining);
            }
          });
        } else if (audioRef.current) {
          audioRef.current.currentTime = remaining;
          setPosition(remaining);
        }
        return;
      }
      remaining -= d;
    }
  }

  if (segments.length === 0) {
    return (
      <div className="rounded-sm border border-ink-500/15 bg-parchment-50 p-8 text-center">
        <p className="font-display text-base text-ink-700">
          No voice narration yet.
        </p>
        <p className="mt-2 text-xs text-ink-500">
          An admin can generate it from the book&apos;s edit page.
        </p>
      </div>
    );
  }

  const pct = totalDuration > 0 ? (totalElapsed / totalDuration) * 100 : 0;

  return (
    <div className="rounded-sm border ml-hairline bg-parchment-50 p-4 shadow-paper sm:p-5">
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        preload="metadata"
      />

      {/* Header — chapter + segment + page tracker */}
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
            Segment {segIdx + 1} of {segments.length}
          </p>
          {currentChapter ? (
            <>
              <p className="mt-1 truncate font-display text-lg leading-tight text-ink-900">
                {currentChapter.title}
              </p>
              <p className="mt-0.5 text-sm text-ink-500">
                Page {currentPage}
                {current && current.page_end !== current.page_start && (
                  <span> · pp {current.page_start}–{current.page_end}</span>
                )}
              </p>
            </>
          ) : (
            <p className="mt-1 font-display text-lg text-ink-900">
              Page {currentPage}
              {current && current.page_end !== current.page_start && (
                <span className="ml-1 text-sm text-ink-500">
                  · narrating pp {current.page_start}–{current.page_end}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-xs text-ink-700">
            {fmt(totalElapsed)} / {fmt(totalDuration)}
          </p>
        </div>
      </div>

      {/* Scrubber — across full book */}
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          handleSegmentSeek(ratio * totalDuration);
        }}
        className="relative block h-2 w-full overflow-hidden rounded-full bg-parchment-200"
        aria-label="Seek"
      >
        <div
          className="absolute inset-y-0 left-0 bg-oxblood-600 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
        {/* Segment dividers — show where chunks split */}
        {segments.slice(0, -1).map((s, i) => {
          const cumulative = segments
            .slice(0, i + 1)
            .reduce((sum, seg) => sum + (seg.duration || 0), 0);
          const pos = totalDuration > 0 ? (cumulative / totalDuration) * 100 : 0;
          return (
            <span
              key={i}
              className="absolute top-0 h-full w-px bg-parchment-50"
              style={{ left: `${pos}%` }}
            />
          );
        })}
      </button>

      {/* Controls — 5-button row: prev-segment, -10s, play/pause, +10s, next-segment */}
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={skipBack}
          className="rounded-full p-2 text-ink-700 hover:bg-parchment-100"
          aria-label="Previous segment"
          title="Previous chapter / restart this one"
        >
          <SkipBack size={18} />
        </button>
        <button
          type="button"
          onClick={() => nudgeBackward(NUDGE_SECONDS)}
          className="inline-flex items-center gap-1 rounded-sm border border-ink-500/20 bg-parchment-50 px-2.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-700 hover:bg-parchment-100"
          aria-label="Rewind 10 seconds"
          title="Rewind 10s"
        >
          <Rewind size={13} /> 10s
        </button>
        <button
          type="button"
          onClick={togglePlay}
          disabled={loading}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-oxblood-700 bg-oxblood-600 text-parchment-50 hover:bg-oxblood-700 disabled:opacity-50"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={() => nudgeForward(NUDGE_SECONDS)}
          className="inline-flex items-center gap-1 rounded-sm border border-ink-500/20 bg-parchment-50 px-2.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-700 hover:bg-parchment-100"
          aria-label="Forward 10 seconds"
          title="Forward 10s"
        >
          10s <FastForward size={13} />
        </button>
        <button
          type="button"
          onClick={skipForward}
          disabled={segIdx >= segments.length - 1}
          className="rounded-full p-2 text-ink-700 hover:bg-parchment-100 disabled:opacity-30"
          aria-label="Next segment"
          title="Next chapter"
        >
          <SkipForward size={18} />
        </button>
      </div>

      {/* Rate selector */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
          Speed
        </span>
        {[0.85, 1, 1.15, 1.3, 1.5, 1.75, 2].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRate(r)}
            className={
              "rounded-sm border px-2 py-0.5 font-mono text-[0.65rem] transition-colors " +
              (rate === r
                ? "border-oxblood-600/40 bg-oxblood-50 text-oxblood-700"
                : "border-ink-500/20 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
            }
          >
            {r}×
          </button>
        ))}
      </div>

      {/* Restart button + info */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t ml-hairline pt-3">
        <button
          type="button"
          onClick={() => {
            setSegIdx(0);
            if (audioRef.current) audioRef.current.currentTime = 0;
            setPosition(0);
          }}
          className="inline-flex items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500 hover:text-oxblood-700"
        >
          <RotateCcw size={11} /> Restart
        </button>
        {error && (
          <p className="text-xs text-oxblood-700">{error}</p>
        )}
      </div>
    </div>
  );
}
