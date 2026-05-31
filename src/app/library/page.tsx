"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { RoomCard } from "@/components/library/RoomCard";
import { BookGrid } from "@/components/library/BookGrid";
import { useAuth } from "@/contexts/AuthContext";
import { listBooks } from "@/lib/books";
import { watchUserProgress } from "@/lib/progress";
import type { Room } from "@/lib/taxonomy";
import type { Book, ReadingProgressDoc } from "@/lib/types";

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
  const { firebaseUser, userDoc } = useAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [progressDocs, setProgressDocs] = useState<ReadingProgressDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listBooks({ status: "published" })
      .then(setBooks)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    return watchUserProgress(firebaseUser.uid, setProgressDocs);
  }, [firebaseUser]);

  const counts: Record<string, number> = {};
  for (const b of books)
    for (const r of b.rooms ?? []) counts[r] = (counts[r] ?? 0) + 1;

  const recent = books.slice(0, 8);
  const greeting = useMemo(() => greetingFor(new Date()), []);
  const firstName =
    userDoc?.display_name?.split(/[\s|]/)[0] ?? "Reader";

  // "Continue reading" — books with currently_reading status, newest first.
  const continueReading = useMemo<Book[]>(() => {
    const bookMap = new Map(books.map((b) => [b.id, b]));
    return progressDocs
      .filter((p) => p.status === "currently_reading")
      .sort((a, b) => {
        const at = (a.last_read_at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const bt = (b.last_read_at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return bt - at;
      })
      .map((p) => bookMap.get(p.book_id))
      .filter((b): b is Book => !!b)
      .slice(0, 5);
  }, [progressDocs, books]);

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
      {/* Editorial hero */}
      <section className="pb-12">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          {greeting}, {firstName}
        </p>
        <h1 className="mt-4 font-display text-3xl leading-[1.05] tracking-tightest sm:text-4xl md:text-6xl">
          Eleven rooms. <span className="text-ink-600">Choose where to read.</span>
        </h1>
      </section>

      {/* Continue reading — only when something is active */}
      {continueReading.length > 0 && (
        <section className="mb-14">
          <header className="mb-5 flex items-baseline justify-between border-b ml-hairline pb-3">
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-ink-500">
                Continue reading
              </p>
              <h2 className="mt-1 font-display text-2xl tracking-tight">
                Where you left off
              </h2>
            </div>
            <Link
              href="/library/shelf"
              className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:underline"
            >
              All shelves →
            </Link>
          </header>
          <BookGrid books={continueReading} />
        </section>
      )}

      {/* Rooms grid */}
      <section>
        <header className="mb-5 flex items-baseline justify-between border-b ml-hairline pb-3">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-ink-500">
            The architecture
          </p>
          <p className="hidden font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500 md:block">
            {books.length} book{books.length === 1 ? "" : "s"} across 11 rooms
          </p>
        </header>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {ROOM_LAYOUT.map(({ key, size }) => (
            <RoomCard key={key} roomKey={key} count={counts[key] ?? 0} size={size} />
          ))}
        </div>
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
            <BookOpen className="mr-1 inline" size={12} />
            Fetching the catalogue…
          </p>
        ) : (
          <BookGrid books={recent} emptyMessage="The shelves are awaiting the first book." />
        )}
      </section>
    </main>
  );
}

/** Time-of-day greeting that respects the user's wall-clock. */
function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late hour";
}
