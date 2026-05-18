"use client";

import type { Book } from "@/lib/types";
import { BookCard } from "./BookCard";

interface BookGridProps {
  books: Book[];
  emptyMessage?: string;
}

export function BookGrid({
  books,
  emptyMessage = "No books here yet.",
}: BookGridProps) {
  if (books.length === 0) {
    return (
      <div className="ml-rule-double mx-auto max-w-md px-6 py-10 text-center">
        <p className="font-display text-lg text-ink-700">{emptyMessage}</p>
        <p className="mt-2 text-sm text-ink-500">
          Check back soon — the shelves are still being filled.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {books.map((b) => (
        <BookCard key={b.id} book={b} />
      ))}
    </div>
  );
}
