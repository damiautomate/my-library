"use client";

import { Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search titles, authors…",
}: SearchBarProps) {
  return (
    <div className="relative">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-ink-500/25 bg-parchment-50 py-2 pl-9 pr-3 text-sm placeholder:text-ink-500/70 focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700/20"
      />
    </div>
  );
}

/** Free-text matcher across title, subtitle, authors. */
export function matchesQuery<
  T extends { title?: string; subtitle?: string; authors?: string[] },
>(book: T, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.toLowerCase();
  if (book.title?.toLowerCase().includes(needle)) return true;
  if (book.subtitle?.toLowerCase().includes(needle)) return true;
  if (book.authors?.some((a) => a.toLowerCase().includes(needle))) return true;
  return false;
}
