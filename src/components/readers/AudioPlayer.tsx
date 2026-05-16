"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { makeDebouncedSaver } from "@/lib/progress";

interface AudioPlayerProps {
  url: string;
  userId: string;
  bookId: string;
  /** Initial position in seconds. */
  initialSeconds?: number;
  /** Optional total duration hint (Cloudinary may provide this on upload). */
  durationHint?: number;
  onPercentChange?: (pct: number) => void;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  url,
  userId,
  bookId,
  initialSeconds = 0,
  durationHint,
  onPercentChange,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number>(durationHint ?? 0);
  const [current, setCurrent] = useState<number>(initialSeconds);
  const [playing, setPlaying] = useState(false);

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1500),
    [userId, bookId],
  );

  // Restore initial position once the metadata is known
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onMeta = () => {
      setDuration(a.duration);
      if (initialSeconds > 0 && initialSeconds < a.duration) {
        a.currentTime = initialSeconds;
        setCurrent(initialSeconds);
      }
    };
    a.addEventListener("loadedmetadata", onMeta);
    return () => a.removeEventListener("loadedmetadata", onMeta);
  }, [initialSeconds]);

  // Save every 10s while playing (spec §16)
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const a = audioRef.current;
      if (!a) return;
      const sec = a.currentTime;
      const pct = duration > 0 ? Math.round((sec / duration) * 100) : undefined;
      saver.save({ current_audio_seconds: Math.round(sec), current_percent: pct });
      if (pct !== undefined) onPercentChange?.(pct);
    }, 10_000);
    return () => clearInterval(id);
  }, [playing, duration, saver, onPercentChange]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      void saver.flush();
    };
  }, [saver]);

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const a = audioRef.current;
    if (!a) return;
    const v = Number(e.target.value);
    a.currentTime = v;
    setCurrent(v);
    const pct = duration > 0 ? Math.round((v / duration) * 100) : undefined;
    saver.save({ current_audio_seconds: Math.round(v), current_percent: pct });
    if (pct !== undefined) onPercentChange?.(pct);
  }

  function handlePauseOrPlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
    } else {
      a.pause();
      // Save on pause (spec §16)
      const pct =
        duration > 0 ? Math.round((a.currentTime / duration) * 100) : undefined;
      saver.save({
        current_audio_seconds: Math.round(a.currentTime),
        current_percent: pct,
      });
    }
  }

  function skip(delta: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(duration, a.currentTime + delta));
    setCurrent(a.currentTime);
  }

  return (
    <div className="ml-card p-5">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onTimeUpdate={(e) => setCurrent((e.target as HTMLAudioElement).currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => skip(-15)}
          className="rounded-full p-2 text-ink-700 hover:bg-parchment-100"
          aria-label="Back 15 seconds"
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          onClick={handlePauseOrPlay}
          className="rounded-full border border-oxblood-700 bg-oxblood-600 p-3 text-parchment-50 hover:bg-oxblood-700"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={current}
            onChange={handleSeek}
            className="w-full accent-oxblood-600"
            aria-label="Scrubber"
          />
          <div className="mt-1 flex justify-between font-mono text-[0.65rem] text-ink-600">
            <span>{fmt(current)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
