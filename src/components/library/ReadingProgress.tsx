"use client";

import type { ReadingProgressDoc } from "@/lib/types";
import { BookOpen, Bookmark, Check, Pause, X } from "lucide-react";

const STATUS_META: Record<
  ReadingProgressDoc["status"],
  { label: string; tone: string; Icon: typeof BookOpen }
> = {
  want_to_read: {
    label: "Want to read",
    tone: "ml-chip ml-chip--gold",
    Icon: Bookmark,
  },
  currently_reading: {
    label: "Currently reading",
    tone: "ml-chip ml-chip--accent",
    Icon: BookOpen,
  },
  finished: { label: "Finished", tone: "ml-chip ml-chip--forest", Icon: Check },
  paused: { label: "Paused", tone: "ml-chip", Icon: Pause },
  abandoned: { label: "Abandoned", tone: "ml-chip", Icon: X },
};

interface ReadingProgressProps {
  progress: ReadingProgressDoc | null | undefined;
}

export function ReadingProgress({ progress }: ReadingProgressProps) {
  if (!progress) return null;
  const meta = STATUS_META[progress.status];
  const pct = progress.current_percent ?? 0;

  return (
    <div className="rounded-sm border ml-hairline bg-parchment-50 p-4 shadow-paper">
      <div className="flex items-center justify-between gap-3">
        <span className={meta.tone}>
          <meta.Icon size={11} />
          {meta.label}
        </span>
        {progress.current_percent !== undefined && (
          <span className="font-mono text-xs text-ink-700">{pct}%</span>
        )}
      </div>
      {progress.current_percent !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-parchment-200">
          <div
            className="h-full bg-oxblood-600"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {progress.current_page !== undefined && (
        <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          Page {progress.current_page}
        </p>
      )}
    </div>
  );
}
