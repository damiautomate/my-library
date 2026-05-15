"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { RoomCard } from "@/components/library/RoomCard";
import { BookGrid } from "@/components/library/BookGrid";
import { ROOM_KEYS, type Room } from "@/lib/taxonomy";
import { listBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

// Asymmetric layout — varied card sizes for visual rhythm (spec §10)
const ROOM_LAYOUT: { key: Room; size: "1x1" | "2x1" | "1x2" }[] = [
  { key: "hall_of_awakening", size: "2x1" },
  { key: "foundation_room", size: "1x1" },
  { key: "workshop", size: "1x1" },
  { key: "counting_room", size: "1x1" },
  { key: "chapel", size: "2x1" },
  { key: "drawing_room", size: "1x1" },
  { key: "war_room", size: "1x1" },
  { key: "observatory", size: "1x1" },
  { key: "garden", size: "1x1" },
  { key: "hall_of_elders", size: "2x1" },
  { key: "childrens_wing", size: "1x1" },
];

export default function LibraryHomePage() {
  return (
    <AuthGuard>
      <Header />
      <LibraryHomeContent />
    </AuthGuard>
  );
}

function LibraryHomeContent() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBooks({ status: "published" })
      .then(setBooks)
      .finally(() => setLoading(false));
  }, []);

  const counts: Record<string, number> = {};
  for (const b of books)
    for (const r of b.rooms ?? []) counts[r] = (counts[r] ?? 0) + 1;

  const recent = books.slice(0, 10);

  return (
    <main className="mx-auto max-w-7xl px-6 pb-24 pt-12">
      {/* Hero band */}
      <section className="pb-12">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          The Library
        </p>
        <h1 className="mt-4 font-display text-5xl leading-[1.05] tracking-tightest md:text-6xl">
          Eleven rooms. <span className="text-ink-600">Choose where to read.</span>
        </h1>
      </section>

      {/* Rooms grid */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {ROOM_LAYOUT.map(({ key, size }) => (
          <RoomCard key={key} roomKey={key} count={counts[key] ?? 0} size={size} />
        ))}
      </section>

      {/* Recently added strip */}
      <section className="mt-20">
        <header className="mb-6 flex items-baseline justify-between border-b ml-hairline pb-3">
          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-ink-500">
              Recently added
            </p>
            <h2 className="mt-1 font-display text-2xl tracking-tight">
              On the new-arrivals table
            </h2>
          </div>
        </header>

        {loading ? (
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink-500">
            Fetching the catalogue…
          </p>
        ) : (
          <BookGrid books={recent} emptyMessage="The shelves are awaiting the first book." />
        )}
      </section>

      {ROOM_KEYS.length !== 11 && (
        <p className="mt-8 text-xs text-oxblood-700">
          Warning: room taxonomy is out of sync ({ROOM_KEYS.length} rooms loaded).
        </p>
      )}
    </main>
  );
}
