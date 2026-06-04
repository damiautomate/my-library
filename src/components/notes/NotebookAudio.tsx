"use client";

import { Headphones, PenLine } from "lucide-react";
import { useBookAudio } from "@/components/audio/BookAudioProvider";
import type { NoteSeed } from "@/lib/notes";

/**
 * Slim strip shown atop the notebook for books with narration. Playback lives
 * in the shared dock (so it continues from the reader); this just lets the
 * member capture a note anchored to whatever is being narrated right now.
 */
export function NotebookAudio({
  onNoteThisMoment,
}: {
  onNoteThisMoment: (seed: NoteSeed) => void;
}) {
  const audio = useBookAudio();
  if (!audio.hasVoice) return null;
  return (
    <section className="flex items-center justify-between gap-2 rounded-sm border ml-hairline bg-parchment-100/50 px-4 py-2.5">
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-ink-600">
        <Headphones size={12} />
        <span className="hidden sm:inline">Listening below? Capture the moment</span>
        <span className="sm:hidden">Capture the moment</span>
      </span>
      <button
        type="button"
        onClick={() => onNoteThisMoment(audio.currentSeed())}
        className="inline-flex items-center gap-1.5 rounded-full border border-oxblood-600/50 bg-oxblood-50 px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-oxblood-700 hover:bg-oxblood-50/70"
      >
        <PenLine size={12} />
        Note this moment
      </button>
    </section>
  );
}
