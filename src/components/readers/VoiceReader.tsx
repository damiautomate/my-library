"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { makeDebouncedSaver } from "@/lib/progress";
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
  onPercentChange?: (pct: number) => void;
  /** Called as voice narration advances through pages. */
  onPageChange?: (page: number) => void;
}

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
  onPercentChange,
  onPageChange,
}: VoiceReaderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [segIdx, setSegIdx] = useState(() => segmentForPage(segments, initialPage));
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // seconds within current segment
  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

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

  // Persist progress with the page tracking convention shared by PDF/EPUB
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
    });
  }, [currentPage, totalElapsed, totalDuration, totalPages, onPercentChange, onPageChange, saver, current]);

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

  // Set up audio element on segment change
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    el.src = current.url;
    el.playbackRate = rate;
    setPosition(0);
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
  }, [playing]);

  const skipForward = useCallback(() => {
    if (segIdx < segments.length - 1) {
      setSegIdx(segIdx + 1);
    }
  }, [segIdx, segments.length]);

  const skipBack = useCallback(() => {
    if (position > 3) {
      // If we're more than 3s in, jump to start of current segment
      const el = audioRef.current;
      if (el) {
        el.currentTime = 0;
        setPosition(0);
      }
    } else if (segIdx > 0) {
      setSegIdx(segIdx - 1);
    }
  }, [segIdx, position]);

  // Auto-advance to next segment when current ends
  function handleEnded() {
    if (segIdx < segments.length - 1) {
      setSegIdx(segIdx + 1);
      // Keep playing across segment boundary
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

      {/* Controls */}
      <div className="mt-5 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={skipBack}
          className="rounded-full p-2 text-ink-700 hover:bg-parchment-100"
          aria-label="Skip back"
        >
          <SkipBack size={18} />
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
          onClick={skipForward}
          disabled={segIdx >= segments.length - 1}
          className="rounded-full p-2 text-ink-700 hover:bg-parchment-100 disabled:opacity-30"
          aria-label="Skip forward"
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
