"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Flame, BookOpen, Clock, FileText, Trophy } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase/client";
import { listBooks } from "@/lib/books";
import { watchUserProgress } from "@/lib/progress";
import { buildCalendar, computeStats, localYmd } from "@/lib/passport";
import type {
  Book,
  ReadingProgressDoc,
  UserDoc,
} from "@/lib/types";

export default function PassportPage() {
  return (
    <AuthGuard>
      <Header />
      <PassportContent />
    </AuthGuard>
  );
}

function PassportContent() {
  const { firebaseUser, userDoc } = useAuth();
  const [progressDocs, setProgressDocs] = useState<ReadingProgressDoc[]>([]);
  const [books, setBooks] = useState<Map<string, Book>>(new Map());
  const [liveUser, setLiveUser] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // Subscribe to the user's own doc so reading_days updates live
  useEffect(() => {
    if (!firebaseUser) return;
    return onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
      if (snap.exists()) setLiveUser(snap.data() as UserDoc);
    });
  }, [firebaseUser]);

  // Watch progress + load book catalogue once for lookup
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    (async () => {
      const all = await listBooks({ status: "published" });
      if (cancelled) return;
      setBooks(new Map(all.map((b) => [b.id, b])));
      unsub = watchUserProgress(firebaseUser.uid, (docs) => {
        setProgressDocs(docs);
        setLoading(false);
      });
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [firebaseUser]);

  const stats = useMemo(
    () =>
      computeStats(
        liveUser?.reading_days ?? userDoc?.reading_days,
        progressDocs,
        books,
      ),
    [liveUser, userDoc, progressDocs, books],
  );

  const calendar = useMemo(
    () => buildCalendar(liveUser?.reading_days ?? userDoc?.reading_days, 26),
    [liveUser, userDoc],
  );

  const displayName =
    userDoc?.display_name?.split(/[\s|]/)[0] ?? "Reader";

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
      <header className="mb-10 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Reader's Passport
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tightest md:text-5xl">
          {displayName}'s reading life
        </h1>
      </header>

      {loading ? (
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Counting the volumes…
        </p>
      ) : (
        <>
          {/* Hero stats */}
          <section className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
            <BigStat
              icon={<Flame size={16} className="text-oxblood-700" />}
              label="Current streak"
              value={stats.currentStreak}
              suffix={stats.currentStreak === 1 ? "day" : "days"}
            />
            <BigStat
              icon={<BookOpen size={16} className="text-oxblood-700" />}
              label={`Finished in ${new Date().getFullYear()}`}
              value={stats.finishedThisYear}
              suffix={stats.finishedThisYear === 1 ? "book" : "books"}
            />
            <BigStat
              icon={<FileText size={16} className="text-oxblood-700" />}
              label="Pages read"
              value={stats.totalPagesRead}
            />
            <BigStat
              icon={<Clock size={16} className="text-oxblood-700" />}
              label="Hours read"
              value={Math.round(stats.totalHoursRead)}
            />
          </section>

          {/* Streak detail + secondary stats */}
          <section className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            <Card>
              <CardLabel>Reading rhythm</CardLabel>
              <div className="mt-3 space-y-1.5 font-display text-ink-900">
                <Row label="Longest streak" value={`${stats.longestStreak} days`} />
                <Row label="Total reading days" value={`${stats.totalReadingDays}`} />
                <Row label="Currently reading" value={`${stats.currentlyReading}`} />
                <Row label="Finished total" value={`${stats.totalFinished}`} />
              </div>
            </Card>

            <div className="md:col-span-2">
              <Card>
                <div className="flex items-baseline justify-between">
                  <CardLabel>Last 26 weeks</CardLabel>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
                    Days with reading activity
                  </span>
                </div>
                <ContributionCalendar grid={calendar} />
              </Card>
            </div>
          </section>

          {/* Breakdowns */}
          <section className="mb-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            <Card>
              <CardLabel>Favourite rooms</CardLabel>
              <BreakdownList items={stats.byRoom} maxCount={stats.byRoom[0]?.count} />
            </Card>
            <Card>
              <CardLabel>Top life domains</CardLabel>
              <BreakdownList
                items={stats.byDomain}
                maxCount={stats.byDomain[0]?.count}
              />
            </Card>
            <Card>
              <CardLabel>Life stages</CardLabel>
              <BreakdownList
                items={stats.byStage}
                maxCount={stats.byStage[0]?.count}
              />
            </Card>
          </section>

          {/* Top authors + recent finishes */}
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Card>
              <CardLabel>Most-read authors</CardLabel>
              {stats.topAuthors.length === 0 ? (
                <p className="mt-4 text-sm text-ink-500">
                  Finish a book to see your authors here.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-ink-500/10">
                  {stats.topAuthors.map((a) => (
                    <li
                      key={a.name}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="font-display text-base">{a.name}</span>
                      <span className="ml-chip ml-chip--gold">
                        <Trophy size={10} />
                        {a.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardLabel>Recent finishes</CardLabel>
              {stats.recentFinished.length === 0 ? (
                <p className="mt-4 text-sm text-ink-500">
                  Nothing closed yet. The "Mark as finished" prompt appears in
                  the reader when you cross 95%.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {stats.recentFinished.map(({ book, finishedAt }) => (
                    <li key={book.id} className="flex items-start gap-3">
                      <Link
                        href={`/book/${book.id}`}
                        className="flex-shrink-0"
                      >
                        <div className="h-16 w-12 overflow-hidden rounded-sm border ml-hairline bg-parchment-200">
                          {book.cover_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={book.cover_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                      </Link>
                      <div className="min-w-0">
                        <Link
                          href={`/book/${book.id}`}
                          className="font-display text-base leading-tight text-ink-900 hover:underline"
                        >
                          {book.title}
                        </Link>
                        <p className="truncate text-xs text-ink-600">
                          {book.authors?.join(", ")}
                        </p>
                        {finishedAt && (
                          <p className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
                            {finishedAt.toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return <div className="ml-card p-5">{children}</div>;
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
      {children}
    </p>
  );
}

function BigStat({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="ml-card p-5">
      <div className="flex items-center gap-2">
        {icon}
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-600">
          {label}
        </p>
      </div>
      <p className="mt-3 font-display text-4xl tracking-tightest text-ink-900 md:text-5xl">
        {value.toLocaleString()}
      </p>
      {suffix && (
        <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          {suffix}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b ml-hairline pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-sm text-ink-600">{label}</span>
      <span className="font-display text-base">{value}</span>
    </div>
  );
}

function BreakdownList({
  items,
  maxCount,
}: {
  items: { key: string; label: string; count: number }[];
  maxCount?: number;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-ink-500">
        No data yet — finish a few books.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {items.map((it) => {
        const pct = maxCount ? (it.count / maxCount) * 100 : 0;
        return (
          <li key={it.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-sm text-ink-800">{it.label}</span>
              <span className="font-mono text-xs text-ink-600">{it.count}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-parchment-200">
              <div
                className="h-full bg-oxblood-600/70"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ContributionCalendar({
  grid,
}: {
  grid: { date: string; read: boolean }[][];
}) {
  const todayYmd = localYmd(new Date());
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="inline-flex gap-[3px]">
        {grid.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((cell) => (
              <div
                key={cell.date}
                title={`${cell.date}${cell.read ? " · read" : ""}`}
                className={
                  "h-3 w-3 rounded-[2px] " +
                  (cell.read
                    ? "bg-oxblood-600"
                    : "bg-parchment-200 ring-inset ring-ink-500/5") +
                  (cell.date === todayYmd ? " ring-1 ring-ink-700/40" : "")
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
