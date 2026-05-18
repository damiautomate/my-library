"use client";

import clsx from "clsx";
import { ReactNode } from "react";

interface TagProps {
  children: ReactNode;
  tone?: "neutral" | "accent" | "forest" | "gold";
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
}

export function Tag({
  children,
  tone = "neutral",
  onRemove,
  onClick,
  active = false,
}: TagProps) {
  const toneClass =
    tone === "accent"
      ? "ml-chip--accent"
      : tone === "forest"
        ? "ml-chip--forest"
        : tone === "gold"
          ? "ml-chip--gold"
          : "";

  return (
    <span
      onClick={onClick}
      className={clsx(
        "ml-chip",
        toneClass,
        onClick && "cursor-pointer transition-colors",
        active && "ring-1 ring-ink-700/40",
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-1 ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-600 hover:bg-ink-900/10 hover:text-ink-900"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </span>
  );
}
