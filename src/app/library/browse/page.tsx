"use client";

import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { BookGrid } from "@/components/library/BookGrid";
import {
  EMPTY_FILTERS,
  FilterSidebar,
  applyFilters,
  type Filters,
} from "@/components/library/FilterSidebar";
import { SearchBar, matchesQuery } from "@/components/library/SearchBar";
import { listBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

export default function BrowsePage() {
  return (
    <AuthGuard>
      <Header />
      <BrowseContent />
    </AuthGuard>
  );
}

function BrowseContent() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [q, setQ] = useState("");

  useEffect(() => {
    listBooks({ status: "published" })
      .then(setBooks)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => applyFilters(books, filters).filter((b) => matchesQuery(b, q)),
    [books, filters, q],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
      <header className="mb-8 flex flex-col gap-3 border-b ml-hairline pb-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
            Browse
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl">
            Every book, every dimension
          </h1>
        </div>
        <div className="hidden font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500 md:block">
          {filtered.length} of {books.length}
        </div>
      </header>

      <div className="flex flex-col gap-10 lg:flex-row">
        <FilterSidebar filters={filters} onChange={setFilters} />

        <div className="min-w-0 flex-1">
          <div className="mb-6 max-w-md">
            <SearchBar value={q} onChange={setQ} />
          </div>

          {loading ? (
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink-500">
              Fetching the catalogue…
            </p>
          ) : (
            <BookGrid
              books={filtered}
              emptyMessage={
                books.length === 0
                  ? "The shelves are empty. The first book is on its way."
                  : "No books match these filters yet."
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}
