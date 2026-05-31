"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { BookGrid } from "@/components/library/BookGrid";
import { SearchBar } from "@/components/library/SearchBar";
import { listBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

export default function SearchPage() {
  return (
    <AuthGuard>
      <Header />
      <SearchContent />
    </AuthGuard>
  );
}

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(initial);

  useEffect(() => {
    listBooks({ status: "published" })
      .then(setBooks)
      .finally(() => setLoading(false));
  }, []);

  // Keep the URL in sync so search results are shareable + the browser back
  // button works as expected.
  useEffect(() => {
    const t = setTimeout(() => {
      const url = q.trim() ? `/library/search?q=${encodeURIComponent(q.trim())}` : "/library/search";
      router.replace(url, { scroll: false });
    }, 200);
    return () => clearTimeout(t);
  }, [q, router]);

  const results = useMemo(() => {
    if (!q.trim()) return books;
    return searchBooks(books, q);
  }, [books, q]);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Search
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl">
          Find anything in the library
        </h1>
      </header>

      <div className="mb-8 max-w-xl">
        <SearchBar
          value={q}
          onChange={setQ}
          placeholder="Search titles, subtitles, authors, descriptions…"
        />
        <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          {loading
            ? "Reading the index…"
            : q.trim()
              ? `${results.length} match${results.length === 1 ? "" : "es"} of ${books.length}`
              : `${books.length} books in the catalogue`}
        </p>
      </div>

      {!loading && q.trim() && results.length === 0 ? (
        <div className="ml-rule-double mx-auto max-w-md px-6 py-10 text-center">
          <p className="font-display text-lg text-ink-700">No matches.</p>
          <p className="mt-2 text-sm text-ink-500">
            Try a different word, or browse a room directly.
          </p>
        </div>
      ) : (
        <BookGrid books={results} />
      )}
    </main>
  );
}

/**
 * Token-based ranked search across the visible Book[] for Phase 3. The library
 * is small enough that doing this client-side is faster than firing up a
 * separate search service.
 *
 * Scoring (higher = better):
 *   +5 per token found in title
 *   +3 per token found in author
 *   +2 per token found in subtitle
 *   +1 per token found in description
 *   +1 if title contains the full query verbatim (small phrase boost)
 */
function searchBooks(books: Book[], query: string): Book[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return books;
  const phrase = tokens.join(" ");

  function score(b: Book): number {
    const title = b.title?.toLowerCase() ?? "";
    const subtitle = b.subtitle?.toLowerCase() ?? "";
    const authors = b.authors?.join(" ").toLowerCase() ?? "";
    const desc = b.description?.toLowerCase() ?? "";

    let s = 0;
    for (const t of tokens) {
      if (title.includes(t)) s += 5;
      if (authors.includes(t)) s += 3;
      if (subtitle.includes(t)) s += 2;
      if (desc.includes(t)) s += 1;
    }
    if (title.includes(phrase)) s += 1;
    return s;
  }

  return books
    .map((b) => ({ book: b, s: score(b) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.book);
}
