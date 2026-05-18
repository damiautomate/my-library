"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Bookmark, Check, Pause, X as XIcon } from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { BookGrid } from "@/components/library/BookGrid";
import { useAuth } from "@/contexts/AuthContext";
import { getBook, listBooks } from "@/lib/books";
import { watchUserProgress } from "@/lib/progress";
import type { Book, ReadingProgressDoc, ReadingStatus } from "@/lib/types";

const TABS: {
  key: ReadingStatus;
  label: string;
  Icon: typeof BookOpen;
}[] = [
  { key: "currently_reading", label: "Currently reading", Icon: BookOpen },
  { key: "want_to_read", label: "Want to read", Icon: Bookmark },
  { key: "finished", label: "Finished", Icon: Check },
  { key: "paused", label: "Paused", Icon: Pause },
  { key: "abandoned", label: "Abandoned", Icon: XIcon },
];

export default function ShelfPage() {
  return (
    <AuthGuard>
      <Header />
      <ShelfContent />
    </AuthGuard>
  );
}

function ShelfContent() {
  const { firebaseUser } = useAuth();
  const [progressDocs, setProgressDocs] = useState<ReadingProgressDoc[]>([]);
  const [books, setBooks] = useState<Map<string, Book>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ReadingStatus>("currently_reading");

  // Live progress updates for this user
  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    return watchUserProgress(firebaseUser.uid, async (docs) => {
      setProgressDocs(docs);
      // Resolve books referenced by progress docs. For Phase 3 we fetch the
      // catalogue once and use a local map; for App 2 we'll switch to chunked
      // documentId() IN queries.
      const all = await listBooks({ status: "published" });
      setBooks(new Map(all.map((b) => [b.id, b])));
      setLoading(false);
    });
  }, [firebaseUser]);

  // Group progress docs by status
  const byStatus = useMemo(() => {
    const m = new Map<ReadingStatus, ReadingProgressDoc[]>();
    for (const p of progressDocs) {
      if (!m.has(p.status)) m.set(p.status, []);
      m.get(p.status)!.push(p);
    }
    // Most-recently-touched first within each group
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const at = (a.last_read_at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const bt = (b.last_read_at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return bt - at;
      });
    }
    return m;
  }, [progressDocs]);

  const tabBooks: Book[] = (byStatus.get(tab) ?? [])
    .map((p) => books.get(p.book_id))
    .filter((b): b is Book => !!b);

  // Stats — Finished this year + total finished + currently reading count
  const stats = useMemo(() => {
    const now = new Date();
    const thisYearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const finished = progressDocs.filter((p) => p.status === "finished");
    const finishedThisYear = finished.filter((p) => {
      const t = (p.finished_at as { toMillis?: () => number } | undefined)?.toMillis?.();
      return t !== undefined && t >= thisYearStart;
    });
    return {
      currentlyReading: byStatus.get("currently_reading")?.length ?? 0,
      wantToRead: byStatus.get("want_to_read")?.length ?? 0,
      finished: finished.length,
      finishedThisYear: finishedThisYear.length,
    };
  }, [progressDocs, byStatus]);

  return (
    <main className="mx-auto max-w-7xl px-6 pb-24 pt-10">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          My Shelf
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tightest">
          Your reading life
        </h1>
      </header>

      {/* Stats row */}
      <section className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Currently reading" value={stats.currentlyReading} />
        <Stat label="Want to read" value={stats.wantToRead} />
        <Stat
          label={`Finished in ${new Date().getFullYear()}`}
          value={stats.finishedThisYear}
        />
        <Stat label="Finished total" value={stats.finished} />
      </section>

      {/* Tabs */}
      <nav className="mb-6 flex flex-wrap items-center gap-1 border-b ml-hairline pb-3 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
        {TABS.map(({ key, label, Icon }) => {
          const count = byStatus.get(key)?.length ?? 0;
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors " +
                (active
                  ? "border-oxblood-600/60 bg-oxblood-50 text-oxblood-700"
                  : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
              }
            >
              <Icon size={11} />
              {label}
              <span className={active ? "text-oxblood-700/70" : "text-ink-500"}>
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      {loading ? (
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Walking the aisles…
        </p>
      ) : tabBooks.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <BookGrid books={tabBooks} />
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ml-card p-5">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p className="mt-2 font-display text-4xl tracking-tightest text-ink-900">
        {value}
      </p>
    </div>
  );
}

function EmptyState({ tab }: { tab: ReadingStatus }) {
  const msg: Record<ReadingStatus, { title: string; body: React.ReactNode }> = {
    currently_reading: {
      title: "Nothing on the table.",
      body: (
        <>
          When you start reading a book, it appears here. Try{" "}
          <Link
            href="/library/browse"
            className="text-oxblood-700 underline-offset-4 hover:underline"
          >
            browsing the catalogue
          </Link>
          .
        </>
      ),
    },
    want_to_read: {
      title: "No bookmarks yet.",
      body: (
        <>
          Marking a book as "Want to read" on its detail page adds it here for
          later.
        </>
      ),
    },
    finished: {
      title: "Nothing finished yet.",
      body: "Finished books appear here with your rating and closing note.",
    },
    paused: {
      title: "Nothing paused.",
      body: "Books you've set aside but might return to live here.",
    },
    abandoned: {
      title: "Nothing abandoned.",
      body: "Books you've decided not to finish — set the status from a book's detail page.",
    },
  };
  return (
    <div className="ml-rule-double mx-auto max-w-md px-6 py-10 text-center">
      <p className="font-display text-lg text-ink-700">{msg[tab].title}</p>
      <p className="mt-2 text-sm text-ink-500">{msg[tab].body}</p>
    </div>
  );
}
