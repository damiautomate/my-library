"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Edit, Archive, Plus, Eye, Layers, Send } from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { SearchBar, matchesQuery } from "@/components/library/SearchBar";
import { Button } from "@/components/ui/Button";
import { archiveBook, listBooks } from "@/lib/books";
import { ROOMS } from "@/lib/taxonomy";
import type { Book, BookStatus } from "@/lib/types";

export default function AdminBooksPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <AdminBooksContent />
    </AuthGuard>
  );
}

function AdminBooksContent() {
  const [books, setBooks] = useState<Book[]>([]);
  const [statusFilter, setStatusFilter] = useState<BookStatus | "all">("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const all = await listBooks();
    setBooks(all);
    setLoading(false);
  }

  async function handleArchive(id: string) {
    if (!confirm("Archive this book? Members will no longer see it.")) return;
    await archiveBook(id);
    await load();
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = books
    .filter((b) => (statusFilter === "all" ? true : b.status === statusFilter))
    .filter((b) => matchesQuery(b, q));

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filtered.every((b) => next.has(b.id));
      if (allSelected) {
        for (const b of filtered) next.delete(b.id);
      } else {
        for (const b of filtered) next.add(b.id);
      }
      return next;
    });
  }

  async function bulkSet(status: BookStatus) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const verb =
      status === "published"
        ? "Publish"
        : status === "archived"
          ? "Archive"
          : "Set to draft";
    if (!confirm(`${verb} ${ids.length} book${ids.length === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    try {
      const u = (await import("@/lib/firebase/client")).auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/books/bulk-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ book_ids: ids, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bulk update failed");
      setSelected(new Set());
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
      <header className="mb-8 flex items-baseline justify-between border-b ml-hairline pb-4">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
            Admin · Books
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tightest">
            The Catalogue
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/books/bulk">
            <Button variant="outline">
              <Layers size={14} /> Bulk
            </Button>
          </Link>
          <Link href="/admin/books/new">
            <Button variant="primary">
              <Plus size={14} /> Add book
            </Button>
          </Link>
        </div>
      </header>

      {/* Filter row */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-sm flex-1">
          <SearchBar value={q} onChange={setQ} placeholder="Search title, author, subtitle…" />
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
          {(["all", "published", "draft", "archived"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3 py-1 transition-colors ${
                statusFilter === s
                  ? "border-oxblood-600/60 bg-oxblood-50 text-oxblood-700"
                  : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar — appears when 1+ books selected */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-4 py-3 shadow-paper">
          <div className="flex items-center gap-3">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700">
              {selected.size} selected
            </p>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500 hover:text-oxblood-700"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void bulkSet("published")}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-sm border border-forest-600/60 bg-forest-50 px-3 py-1.5 text-xs text-forest-600 hover:bg-forest-50/70 disabled:opacity-50"
            >
              <Send size={12} /> Publish
            </button>
            <button
              type="button"
              onClick={() => void bulkSet("draft")}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-ink-700 hover:bg-parchment-100 disabled:opacity-50"
            >
              Unpublish
            </button>
            <button
              type="button"
              onClick={() => void bulkSet("archived")}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-oxblood-700 hover:bg-oxblood-50 disabled:opacity-50"
            >
              <Archive size={12} /> Archive
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="ml-card overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Loading the shelves…
          </p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-display text-lg text-ink-700">
              {books.length === 0
                ? "No books in the catalogue yet."
                : "No books match this filter."}
            </p>
            {books.length === 0 && (
              <Link href="/admin/books/new">
                <Button className="mt-5" variant="primary">
                  <Plus size={14} /> Add the first book
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b ml-hairline bg-parchment-100 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-ink-600">
              <tr>
                <th className="w-8 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={
                      filtered.length > 0 &&
                      filtered.every((b) => selected.has(b.id))
                    }
                    onChange={toggleAllVisible}
                    className="cursor-pointer accent-oxblood-600"
                    aria-label="Select all visible"
                  />
                </th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Authors</th>
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.id}
                  className={
                    "border-b ml-hairline last:border-b-0 hover:bg-parchment-100/60 " +
                    (selected.has(b.id) ? "bg-oxblood-50/40" : "")
                  }
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggleOne(b.id)}
                      className="cursor-pointer accent-oxblood-600"
                      aria-label={`Select ${b.title}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-display text-base leading-tight">
                      {b.title}
                    </div>
                    {b.subtitle && (
                      <div className="text-xs italic text-ink-600">
                        {b.subtitle}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {b.authors?.join(", ")}
                  </td>
                  <td className="px-4 py-3 font-mono text-[0.7rem] text-oxblood-700">
                    {b.rooms?.[0] ? ROOMS[b.rooms[0]]?.label ?? b.rooms[0] : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={b.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/book/${b.id}`}
                        className="rounded-sm p-1.5 text-ink-600 hover:bg-parchment-200 hover:text-ink-900"
                        title="View"
                      >
                        <Eye size={14} />
                      </Link>
                      <Link
                        href={`/admin/books/${b.id}/edit`}
                        className="rounded-sm p-1.5 text-ink-600 hover:bg-parchment-200 hover:text-ink-900"
                        title="Edit"
                      >
                        <Edit size={14} />
                      </Link>
                      {b.status !== "archived" && (
                        <button
                          onClick={() => handleArchive(b.id)}
                          className="rounded-sm p-1.5 text-oxblood-700 hover:bg-oxblood-50"
                          title="Archive"
                        >
                          <Archive size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: BookStatus }) {
  const map: Record<BookStatus, string> = {
    published: "ml-chip ml-chip--forest",
    draft: "ml-chip ml-chip--gold",
    archived: "ml-chip",
  };
  return <span className={map[status]}>{status}</span>;
}
