"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { VoiceSegment } from "@/lib/types";

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
}

const NUDGE_SECONDS = 10;

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
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
   * Estimate the "current page" being narrated. We interpolate linearly
   * within the segment's page range based on how far through the audio
   * we are. Imperfect (TTS doesn't read at constant page-rate due to
   * page-length variation) but close enough for sync.
   */
  const currentPage = useMemo(() => {
    if (!current) return initialPage;
    const segProgress = current.duration > 0 ? position / current.duration : 0;
    const pageSpan = current.page_end - current.page_start + 1;
    return Math.min(
      current.page_end,
      current.page_start + Math.floor(segProgress * pageSpan),
    );
  }, [current, position, initialPage]);

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

  // Auto-advance to next segment when current ends
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
    <div className="rounded-sm border ml-hairline bg-parchment-50 p-5 shadow-paper">
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        preload="metadata"
      />

      {/* Header — segment + page tracker */}
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
            Segment {segIdx + 1} of {segments.length}
          </p>
          <p className="mt-1 font-display text-lg text-ink-900">
            Page {currentPage}
            {current && current.page_end !== current.page_start && (
              <span className="ml-1 text-sm text-ink-500">
                · narrating pp {current.page_start}–{current.page_end}
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
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
      <div className="mt-5 flex items-center justify-center gap-1.5">
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
