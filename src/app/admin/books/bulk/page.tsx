"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  ExternalLink,
  Wand2,
} from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { auth as firebaseAuth } from "@/lib/firebase/client";
import { createBookWithId, newBookId } from "@/lib/books";
import {
  toBookDoc,
  EMPTY_BOOK_FORM,
  type BookFormValue,
} from "@/components/admin/BookForm";

type RowStatus = "queued" | "ai_filling" | "saving" | "done" | "failed";

interface Row {
  id: string;
  title: string;
  author?: string;
  status: RowStatus;
  bookId?: string;
  filledKeys?: number;
  error?: string;
}

const CONCURRENCY = 2; // run two books in parallel — Anthropic tier 1 is fine

export default function BulkImportPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <BulkContent />
    </AuthGuard>
  );
}

function BulkContent() {
  const { firebaseUser } = useAuth();
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  function parseInput(): Row[] {
    const lines = pasted
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line) => {
      // Accept "Title | Author" or "Title - Author" or just "Title"
      const sep = line.match(/\s+[|—–-]\s+/);
      let title = line;
      let author: string | undefined;
      if (sep) {
        const idx = sep.index ?? 0;
        title = line.slice(0, idx).trim();
        author = line.slice(idx + sep[0].length).trim();
      }
      return {
        id: Math.random().toString(36).slice(2, 9),
        title,
        author,
        status: "queued" as RowStatus,
      };
    });
  }

  const updateRow = useCallback((id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const processOne = useCallback(
    async (row: Row) => {
      if (!firebaseUser) throw new Error("Not signed in");
      const bookId = newBookId();
      updateRow(row.id, { status: "ai_filling", bookId });

      const u = firebaseAuth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/books/ai-fill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: row.title,
          author: row.author,
          // No pdf_url — bulk mode is title-only
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI fill failed");

      updateRow(row.id, { status: "saving" });

      // Build a BookFormValue from the AI response, then convert to a BookDoc
      const formValue: BookFormValue = {
        ...EMPTY_BOOK_FORM,
        title: data.title || row.title,
        subtitle: data.subtitle ?? "",
        authors: (data.authors ?? []).join(", "),
        description: data.description ?? "",
        publisher: data.publisher ?? "",
        publication_year: data.publication_year
          ? String(data.publication_year)
          : "",
        page_count: data.page_count ? String(data.page_count) : "",
        language: data.language ?? "en",
        isbn_10: data.isbn_10 ?? "",
        isbn_13: data.isbn_13 ?? "",
        cover_url: data.cover_url ?? "",
        cover_public_id: "",
        why_this_book: data.why_this_book ?? "",
        life_domains: data.life_domains ?? [],
        life_stages: data.life_stages ?? [],
        rooms: data.rooms ?? [],
        reader_level: data.reader_level ?? "intermediate",
        reading_modes: data.reading_modes ?? [],
        cultural_contexts: data.cultural_contexts ?? [],
        outcomes: data.outcomes ?? [],
        fields: data.fields ?? [],
      };

      await createBookWithId(
        bookId,
        { ...toBookDoc(formValue), status: "draft" },
        firebaseUser.uid,
      );

      // Count filled non-empty values
      let filledCount = 0;
      if (formValue.description) filledCount++;
      if (formValue.publisher) filledCount++;
      if (formValue.publication_year) filledCount++;
      if (formValue.page_count) filledCount++;
      if (formValue.cover_url) filledCount++;
      if (formValue.why_this_book) filledCount++;
      filledCount += formValue.life_domains.length;
      filledCount += formValue.rooms.length;
      filledCount += formValue.life_stages.length;
      filledCount += formValue.reading_modes.length;
      filledCount += formValue.cultural_contexts.length;
      filledCount += formValue.outcomes.length;
      filledCount += formValue.fields.length;

      updateRow(row.id, {
        status: "done",
        filledKeys: filledCount,
      });
    },
    [firebaseUser, updateRow],
  );

  const runAll = useCallback(async () => {
    if (!pasted.trim()) return;
    const parsed = parseInput();
    if (parsed.length === 0) return;
    setRows(parsed);
    setRunning(true);

    // Bounded-concurrency queue
    let idx = 0;
    async function worker() {
      while (idx < parsed.length) {
        const i = idx++;
        const row = parsed[i];
        try {
          await processOne(row);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // we already advanced idx; mutate row via closure
          parsed[i].status = "failed";
          parsed[i].error = msg;
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id ? { ...r, status: "failed", error: msg } : r,
            ),
          );
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, parsed.length) }, worker),
    );

    setRunning(false);
  }, [pasted, processOne]);

  const queuedCount = rows.filter((r) => r.status === "queued").length;
  const doneCount = rows.filter((r) => r.status === "done").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Admin · Bulk import
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tightest">
          Many books at once
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-ink-600">
          Paste a list of titles — one per line. The AI will classify each one
          and create it as a draft. You can edit and upload files for each
          afterwards.
        </p>
        <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          Format: "Title" or "Title | Author Name" or "Title — Author Name"
        </p>
      </header>

      <section className="ml-card mb-6 p-5">
        <label className="mb-2 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
          Books to import ({pasted.split("\n").filter((l) => l.trim()).length})
        </label>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={10}
          placeholder={`Atomic Habits | James Clear
Deep Work | Cal Newport
The 7 Habits of Highly Effective People — Stephen R. Covey
Mere Christianity | C.S. Lewis
The Total Money Makeover | Dave Ramsey`}
          disabled={running}
          className="w-full rounded-sm border border-ink-500/25 bg-parchment-50 p-3 font-mono text-sm leading-relaxed focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700/20 disabled:opacity-50"
        />
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            Each book takes ~5–15s. {CONCURRENCY} run in parallel.
          </p>
          <Button
            variant="primary"
            onClick={runAll}
            disabled={running || !pasted.trim()}
          >
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Working… {doneCount + failedCount}/{rows.length}
              </>
            ) : (
              <>
                <Wand2 size={14} />
                Start import
              </>
            )}
          </Button>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="ml-card overflow-hidden">
          <header className="flex items-center justify-between border-b ml-hairline px-5 py-3">
            <h2 className="font-display text-lg">Progress</h2>
            <div className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
              {doneCount > 0 && (
                <span className="ml-chip ml-chip--forest">
                  ✓ {doneCount} done
                </span>
              )}
              {failedCount > 0 && (
                <span className="ml-chip ml-chip--accent">
                  × {failedCount} failed
                </span>
              )}
              {queuedCount > 0 && <span className="ml-chip">… {queuedCount} queued</span>}
            </div>
          </header>
          <ul className="divide-y divide-ink-500/10">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base leading-tight">
                    {r.title}
                  </p>
                  {r.author && (
                    <p className="text-xs text-ink-600">{r.author}</p>
                  )}
                  {r.error && (
                    <p className="mt-1 text-xs text-oxblood-700">
                      {r.error}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <StatusBadge status={r.status} filledKeys={r.filledKeys} />
                  {r.bookId && r.status === "done" && (
                    <Link
                      href={`/admin/books/${r.bookId}/edit`}
                      className="rounded-sm border border-ink-500/25 bg-parchment-50 p-1.5 text-ink-700 hover:bg-parchment-100"
                      aria-label="Edit"
                    >
                      <ExternalLink size={12} />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function StatusBadge({
  status,
  filledKeys,
}: {
  status: RowStatus;
  filledKeys?: number;
}) {
  if (status === "queued")
    return (
      <span className="ml-chip">
        <Clock size={10} /> Queued
      </span>
    );
  if (status === "ai_filling")
    return (
      <span className="ml-chip ml-chip--accent">
        <Loader2 size={10} className="animate-spin" /> AI…
      </span>
    );
  if (status === "saving")
    return (
      <span className="ml-chip ml-chip--accent">
        <Play size={10} /> Saving
      </span>
    );
  if (status === "done")
    return (
      <span className="ml-chip ml-chip--forest">
        <CheckCircle2 size={10} />
        {filledKeys !== undefined ? ` ${filledKeys} fields` : " Done"}
      </span>
    );
  return (
    <span className="ml-chip ml-chip--accent">
      <AlertCircle size={10} /> Failed
    </span>
  );
}
