"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Edit, Archive, Plus, Eye } from "lucide-react";
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

  const filtered = books
    .filter((b) => (statusFilter === "all" ? true : b.status === statusFilter))
    .filter((b) => matchesQuery(b, q));

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
        <Link href="/admin/books/new">
          <Button variant="primary">
            <Plus size={14} /> Add book
          </Button>
        </Link>
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
                  className="border-b ml-hairline last:border-b-0 hover:bg-parchment-100/60"
                >
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
                    {b.rooms?.[0] ? ROOMS[b.rooms[0]].label : "—"}
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
