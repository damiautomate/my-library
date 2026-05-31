"use client";

import { forwardRef, useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  ExternalLink,
  Wand2,
  FileText,
  Upload,
  Type as TypeIcon,
  X as XIcon,
  Globe,
  Search,
  Send,
} from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { auth as firebaseAuth } from "@/lib/firebase/client";
import { uploadFile } from "@/lib/cloudinary";
import { createBookWithId, newBookId } from "@/lib/books";
import {
  toBookDoc,
  EMPTY_BOOK_FORM,
  type BookFormValue,
} from "@/components/admin/BookForm";

type Mode = "titles" | "pdfs" | "public_domain";

type RowStatus =
  | "queued"
  | "uploading"
  | "ai_filling"
  | "saving"
  | "done"
  | "published"
  | "failed";

interface Row {
  id: string;
  title: string;
  author?: string;
  file?: File; // present for PDF rows
  uploadPct?: number;
  status: RowStatus;
  bookId?: string;
  filledKeys?: number;
  pdfUrl?: string;
  error?: string;
  /** Public-domain source rows */
  source?: "gutenberg" | "se_url";
  gutenberg_id?: number;
  source_url?: string;
  has_epub?: boolean;
  has_pdf?: boolean;
  has_cover?: boolean;
}

/** Pending public-domain source — staged before the user clicks Start. */
interface PendingSource {
  id: string;
  kind: "gutenberg" | "se_url";
  title: string;
  author?: string;
  gutenberg_id?: number;
  url?: string;
}

const CONCURRENCY = 2; // 2 books in parallel keeps us under Anthropic + Cloudinary tier limits

interface GutenbergSearchResult {
  id: number;
  title: string;
  authors: string[];
  languages: string[];
  subjects: string[];
  bookshelves: string[];
  download_count: number;
  epub_url?: string;
  cover_url?: string;
}

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
  const [mode, setMode] = useState<Mode>("titles");
  const [pasted, setPasted] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const filePickerRef = useRef<HTMLInputElement>(null);

  // Public-domain mode state
  const [pendingSources, setPendingSources] = useState<PendingSource[]>([]);
  const [gQuery, setGQuery] = useState("");
  const [gResults, setGResults] = useState<GutenbergSearchResult[]>([]);
  const [gSearching, setGSearching] = useState(false);
  const [gError, setGError] = useState<string | null>(null);
  const [seUrls, setSeUrls] = useState("");

  // ----- Titles mode parsing -----------------------------------------------

  function parseTitles(): Row[] {
    const lines = pasted
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line) => {
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

  // ----- PDFs mode handling ------------------------------------------------

  function addFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    setFiles((prev) => [...prev, ...arr]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearFiles() {
    setFiles([]);
  }

  /** Convert a PDF filename to a title hint. "the_7_habits.pdf" → "The 7 Habits". */
  function titleFromFilename(name: string): string {
    return name
      .replace(/\.pdf$/i, "")
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Take a Standard Ebooks URL and infer a readable title from the path. */
  function deriveTitleFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      // /ebooks/{author}/{title}[/{translator}]
      const titleSlug = parts[2] ?? parts[parts.length - 1] ?? "";
      return titleSlug
        .replace(/-/g, " ")
        .replace(/\.(epub|pdf)$/i, "")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    } catch {
      return url;
    }
  }

  function buildRowsFromFiles(): Row[] {
    return files.map((f) => ({
      id: Math.random().toString(36).slice(2, 9),
      title: titleFromFilename(f.name),
      file: f,
      status: "queued" as RowStatus,
    }));
  }

  // ----- Public-domain mode -----------------------------------------------

  async function runGutenbergSearch() {
    const q = gQuery.trim();
    if (!q) return;
    setGError(null);
    setGSearching(true);
    setGResults([]);
    try {
      const u = firebaseAuth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/books/search-gutenberg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setGResults(data.results ?? []);
    } catch (e) {
      setGError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setGSearching(false);
    }
  }

  function queueGutenberg(book: GutenbergSearchResult) {
    setPendingSources((prev) => {
      if (prev.some((p) => p.kind === "gutenberg" && p.gutenberg_id === book.id))
        return prev; // already queued
      return [
        ...prev,
        {
          id: Math.random().toString(36).slice(2, 9),
          kind: "gutenberg",
          gutenberg_id: book.id,
          title: book.title,
          author: book.authors[0],
        },
      ];
    });
  }

  function queueSEUrls() {
    const urls = seUrls
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    const newOnes: PendingSource[] = urls.map((url) => ({
      id: Math.random().toString(36).slice(2, 9),
      kind: "se_url",
      url,
      title: deriveTitleFromUrl(url),
    }));
    setPendingSources((prev) => [...prev, ...newOnes]);
    setSeUrls("");
  }

  function removePending(id: string) {
    setPendingSources((prev) => prev.filter((p) => p.id !== id));
  }

  function buildRowsFromSources(): Row[] {
    return pendingSources.map((p) => ({
      id: p.id,
      title: p.title,
      author: p.author,
      source: p.kind,
      gutenberg_id: p.gutenberg_id,
      source_url: p.url,
      status: "queued" as RowStatus,
    }));
  }

  // ----- Shared row updater ------------------------------------------------

  const updateRow = useCallback((id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  // ----- Process one row ---------------------------------------------------

  const processOne = useCallback(
    async (row: Row) => {
      if (!firebaseUser) throw new Error("Not signed in");
      const u = firebaseAuth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();

      // ---- Public-domain source rows: server does everything -------------
      if (row.source) {
        updateRow(row.id, { status: "ai_filling" }); // "fetching + classifying"
        const body =
          row.source === "gutenberg"
            ? { source: "gutenberg", gutenberg_id: row.gutenberg_id }
            : {
                source: "url",
                url: row.source_url,
                title_hint: row.title,
                author_hint: row.author,
              };
        const res = await fetch("/api/books/import-source", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Import failed");
        updateRow(row.id, {
          status: "done",
          bookId: data.book_id,
          title: data.title || row.title,
          has_epub: data.has_epub,
          has_pdf: data.has_pdf,
          has_cover: data.has_cover,
        });
        return;
      }

      // ---- Title or PDF rows: client-side upload + AI fill --------------

      const bookId = newBookId();
      updateRow(row.id, { bookId });

      let pdfUrl: string | undefined;
      let pdfPublicId: string | undefined;

      // 1. If we have a PDF file, upload it first
      if (row.file) {
        updateRow(row.id, { status: "uploading", uploadPct: 0 });
        try {
          const result = await uploadFile({
            file: row.file,
            kind: "pdf",
            bookId,
            onProgress: (pct) => updateRow(row.id, { uploadPct: pct }),
          });
          pdfUrl = result.secure_url;
          pdfPublicId = result.public_id;
          updateRow(row.id, { pdfUrl });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Upload failed: ${msg}`);
        }
      }

      // 2. AI Fill (grounded in PDF text if uploaded)
      updateRow(row.id, { status: "ai_filling" });
      const res = await fetch("/api/books/ai-fill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: row.title,
          author: row.author,
          pdf_url: pdfUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI fill failed");

      // 3. Save as draft
      updateRow(row.id, { status: "saving" });

      const formValue: BookFormValue = {
        ...EMPTY_BOOK_FORM,
        title: data.title || row.title,
        subtitle: data.subtitle ?? "",
        authors: (data.authors ?? []).join(", ") || row.author || "",
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

      const bookDoc: Partial<
        Parameters<typeof createBookWithId>[1]
      > = {
        ...toBookDoc(formValue),
        status: "draft",
      };
      if (pdfUrl) bookDoc.pdf_url = pdfUrl;
      if (pdfPublicId) bookDoc.pdf_public_id = pdfPublicId;

      await createBookWithId(bookId, bookDoc, firebaseUser.uid);

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

      updateRow(row.id, { status: "done", filledKeys: filledCount });
    },
    [firebaseUser, updateRow],
  );

  // ----- Kick off the queue ------------------------------------------------

  const runAll = useCallback(async () => {
    const parsed =
      mode === "titles"
        ? parseTitles()
        : mode === "pdfs"
          ? buildRowsFromFiles()
          : buildRowsFromSources();
    if (parsed.length === 0) return;
    setRows(parsed);
    setRunning(true);

    let idx = 0;
    async function worker() {
      while (idx < parsed.length) {
        const i = idx++;
        const row = parsed[i];
        try {
          await processOne(row);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
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
  }, [mode, pasted, files, pendingSources, processOne]);

  /** Publish all rows that finished successfully in this bulk run. */
  const publishAllDone = useCallback(async () => {
    const ids = rows
      .filter((r) => r.status === "done" && r.bookId)
      .map((r) => r.bookId as string);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Publish ${ids.length} book${ids.length === 1 ? "" : "s"}? They'll become visible to all members immediately.`,
      )
    )
      return;
    try {
      const u = firebaseAuth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/books/bulk-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ book_ids: ids, status: "published" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bulk publish failed");
      setRows((prev) =>
        prev.map((r) =>
          r.status === "done" && r.bookId ? { ...r, status: "published" } : r,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Couldn't publish: ${msg}`);
    }
  }, [rows]);

  const queuedCount = rows.filter((r) => r.status === "queued").length;
  const doneCount = rows.filter((r) => r.status === "done").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const publishedCount = rows.filter((r) => r.status === "published").length;
  const inputCount =
    mode === "titles"
      ? pasted.split("\n").filter((l) => l.trim()).length
      : mode === "pdfs"
        ? files.length
        : pendingSources.length;

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Admin · Bulk import
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl">
          Many books at once
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-ink-600">
          Either paste a list of titles (AI classifies each from training data)
          or drop a folder of PDFs (AI reads the first chapter of each and
          classifies from the actual content — slower but more accurate).
        </p>
      </header>

      {/* Mode tabs */}
      <nav className="mb-6 flex flex-wrap items-center gap-1 border-b ml-hairline pb-3">
        <ModeTab
          active={mode === "titles"}
          onClick={() => !running && setMode("titles")}
          icon={<TypeIcon size={13} />}
          label="By titles"
          sub="Title-only, fast"
        />
        <ModeTab
          active={mode === "pdfs"}
          onClick={() => !running && setMode("pdfs")}
          icon={<FileText size={13} />}
          label="By PDF files"
          sub="Reads each PDF, most accurate"
        />
        <ModeTab
          active={mode === "public_domain"}
          onClick={() => !running && setMode("public_domain")}
          icon={<Globe size={13} />}
          label="Public domain"
          sub="Gutenberg + Standard Ebooks"
        />
      </nav>

      {/* Input section — varies by mode */}
      <section className="ml-card mb-6 p-5">
        {mode === "titles" ? (
          <>
            <label className="mb-2 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              Books to import ({inputCount})
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
            <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
              Format: "Title" or "Title | Author Name" or "Title — Author Name"
            </p>
          </>
        ) : mode === "pdfs" ? (
          <>
            <label className="mb-2 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              PDF files ({inputCount} selected)
            </label>

            {/* Drop zone */}
            <FilePicker
              onFiles={addFiles}
              disabled={running}
              ref={filePickerRef}
            />

            {/* Selected files preview */}
            {files.length > 0 && (
              <div className="mt-4 max-h-64 overflow-y-auto rounded-sm border border-ink-500/15 bg-parchment-100/60">
                <ul className="divide-y divide-ink-500/10">
                  {files.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-ink-800">
                          {f.name}
                        </p>
                        <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-500">
                          → {titleFromFilename(f.name)} ·{" "}
                          {(f.size / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        disabled={running}
                        className="rounded-sm p-1 text-ink-500 hover:bg-parchment-200 hover:text-oxblood-700 disabled:opacity-30"
                        aria-label="Remove"
                      >
                        <XIcon size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="border-t ml-hairline px-3 py-2">
                  <button
                    type="button"
                    onClick={clearFiles}
                    disabled={running}
                    className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500 hover:text-oxblood-700 disabled:opacity-50"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}

            <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
              Each file uploads + AI reads ~25 pages + classifies. Takes ~15–30s per book.
              Filenames become initial titles (the AI may canonicalize them).
            </p>
          </>
        ) : (
          <>
            {/* Public-domain: Gutenberg search + Standard Ebooks URL paste */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* --- Gutenberg search column --- */}
              <div>
                <label className="mb-2 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
                  Project Gutenberg search
                </label>
                <div className="flex items-stretch gap-2">
                  <input
                    value={gQuery}
                    onChange={(e) => setGQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void runGutenbergSearch();
                      }
                    }}
                    placeholder="Meditations Marcus Aurelius"
                    disabled={running || gSearching}
                    className="flex-1 rounded-sm border border-ink-500/25 bg-parchment-50 px-3 py-2 text-sm focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700/20 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => void runGutenbergSearch()}
                    disabled={running || gSearching || !gQuery.trim()}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-2 text-sm text-ink-800 hover:bg-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {gSearching ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Search size={12} />
                    )}
                    Search
                  </button>
                </div>
                {gError && (
                  <p className="mt-2 text-xs text-oxblood-700">{gError}</p>
                )}
                <div className="mt-3 max-h-80 overflow-y-auto rounded-sm border border-ink-500/15">
                  {gResults.length === 0 ? (
                    <p className="px-3 py-4 text-center font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
                      {gSearching
                        ? "Searching…"
                        : "Search Project Gutenberg's 70k+ public-domain books"}
                    </p>
                  ) : (
                    <ul className="divide-y divide-ink-500/10">
                      {gResults.map((b) => {
                        const alreadyQueued = pendingSources.some(
                          (p) =>
                            p.kind === "gutenberg" && p.gutenberg_id === b.id,
                        );
                        return (
                          <li
                            key={b.id}
                            className="flex items-start gap-3 p-3"
                          >
                            {b.cover_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={b.cover_url}
                                alt=""
                                className="h-14 w-10 flex-shrink-0 rounded-sm object-cover"
                              />
                            ) : (
                              <div className="h-14 w-10 flex-shrink-0 rounded-sm bg-parchment-200" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 font-display text-sm text-ink-900">
                                {b.title}
                              </p>
                              <p className="truncate text-xs text-ink-600">
                                {b.authors.join(", ") || "Unknown"}
                              </p>
                              <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-500">
                                #{b.id} · {b.download_count.toLocaleString()} downloads
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => queueGutenberg(b)}
                              disabled={alreadyQueued || running}
                              className="flex-shrink-0 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-2 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:bg-oxblood-50/70 disabled:cursor-not-allowed disabled:border-ink-500/20 disabled:bg-parchment-100 disabled:text-ink-500"
                            >
                              {alreadyQueued ? "Queued" : "Queue"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* --- Standard Ebooks URL paste --- */}
              <div>
                <label className="mb-2 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
                  Standard Ebooks URLs
                </label>
                <textarea
                  value={seUrls}
                  onChange={(e) => setSeUrls(e.target.value)}
                  rows={5}
                  placeholder={`https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long
https://standardebooks.org/ebooks/sun-tzu/the-art-of-war/lionel-giles`}
                  disabled={running}
                  className="w-full rounded-sm border border-ink-500/25 bg-parchment-50 p-3 font-mono text-xs leading-relaxed focus:border-ink-700 focus:outline-none focus:ring-1 focus:ring-ink-700/20 disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
                    Paste book-page URLs · one per line
                  </p>
                  <button
                    type="button"
                    onClick={queueSEUrls}
                    disabled={running || !seUrls.trim()}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-2 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-ink-800 hover:bg-parchment-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Queue all
                  </button>
                </div>
                <p className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-500">
                  Or paste any direct .epub / .pdf URL — works for other
                  public-domain hosts too.
                </p>
              </div>
            </div>

            {/* --- Queued sources preview --- */}
            {pendingSources.length > 0 && (
              <div className="mt-5 max-h-64 overflow-y-auto rounded-sm border border-ink-500/15 bg-parchment-100/60">
                <header className="border-b ml-hairline px-3 py-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
                  Queued ({pendingSources.length})
                </header>
                <ul className="divide-y divide-ink-500/10">
                  {pendingSources.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-800">
                          {p.title}
                        </p>
                        <p className="truncate font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-500">
                          {p.kind === "gutenberg"
                            ? `Gutenberg #${p.gutenberg_id}`
                            : p.url}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePending(p.id)}
                        disabled={running}
                        className="rounded-sm p-1 text-ink-500 hover:bg-parchment-200 hover:text-oxblood-700 disabled:opacity-30"
                        aria-label="Remove"
                      >
                        <XIcon size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
              Each queued source: server downloads the file → uploads to your
              Cloudinary → AI classifies → saved as draft. ~10–25s per book.
            </p>
          </>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t ml-hairline pt-4">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            {CONCURRENCY} run in parallel.
            {mode === "pdfs" && " Files uploaded one at a time per worker."}
            {mode === "public_domain" &&
              " Server downloads each book then runs AI."}
          </p>
          <Button
            variant="primary"
            onClick={runAll}
            disabled={running || inputCount === 0}
          >
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Working… {doneCount + failedCount}/{rows.length}
              </>
            ) : (
              <>
                <Wand2 size={14} />
                {mode === "pdfs"
                  ? "Upload & import"
                  : mode === "public_domain"
                    ? "Import queued"
                    : "Start import"}
              </>
            )}
          </Button>
        </div>
      </section>

      {/* Progress table */}
      {rows.length > 0 && (
        <section className="ml-card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b ml-hairline px-5 py-3">
            <h2 className="font-display text-lg">Progress</h2>
            <div className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
              {doneCount > 0 && (
                <span className="ml-chip ml-chip--forest">
                  ✓ {doneCount} done
                </span>
              )}
              {publishedCount > 0 && (
                <span className="ml-chip ml-chip--accent">
                  ↑ {publishedCount} published
                </span>
              )}
              {failedCount > 0 && (
                <span className="ml-chip ml-chip--accent">
                  × {failedCount} failed
                </span>
              )}
              {queuedCount > 0 && <span className="ml-chip">… {queuedCount} queued</span>}
              {doneCount > 0 && !running && (
                <button
                  type="button"
                  onClick={() => void publishAllDone()}
                  className="ml-2 inline-flex items-center gap-1 rounded-sm border border-oxblood-700 bg-oxblood-600 px-3 py-1 font-medium text-parchment-50 hover:bg-oxblood-700"
                >
                  <Send size={11} />
                  Publish {doneCount}
                </button>
              )}
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
                  {r.file && (
                    <p className="truncate font-mono text-[0.65rem] text-ink-500">
                      {r.file.name}
                    </p>
                  )}
                  {r.status === "uploading" && r.uploadPct !== undefined && (
                    <div className="mt-1 h-1 w-48 overflow-hidden rounded-full bg-parchment-200">
                      <div
                        className="h-full bg-oxblood-600 transition-all"
                        style={{ width: `${r.uploadPct}%` }}
                      />
                    </div>
                  )}
                  {r.error && (
                    <p className="mt-1 text-xs text-oxblood-700">{r.error}</p>
                  )}
                  {r.status === "done" && r.source && (
                    <div className="mt-1 flex items-center gap-1.5">
                      {r.has_epub && (
                        <span className="ml-chip text-[0.55rem]">EPUB</span>
                      )}
                      {r.has_pdf && (
                        <span className="ml-chip text-[0.55rem]">PDF</span>
                      )}
                      {r.has_cover && (
                        <span className="ml-chip ml-chip--gold text-[0.55rem]">
                          cover
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <StatusBadge
                    status={r.status}
                    filledKeys={r.filledKeys}
                    uploadPct={r.uploadPct}
                  />
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

// ---------------------------------------------------------------------------

function ModeTab({
  active,
  onClick,
  icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-center gap-2 rounded-sm border px-3 py-2 transition-colors " +
        (active
          ? "border-oxblood-600/40 bg-oxblood-50 text-oxblood-700"
          : "border-ink-500/20 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
      }
    >
      {icon}
      <span className="text-left">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
          {sub}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

const FilePicker = forwardRef<
  HTMLInputElement,
  { onFiles: (files: FileList | File[]) => void; disabled?: boolean }
>(function FilePicker({ onFiles, disabled }, ref) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        if (e.dataTransfer?.files) onFiles(e.dataTransfer.files);
      }}
      className={
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-sm border-2 border-dashed py-10 transition-colors " +
        (disabled
          ? "border-ink-500/15 bg-parchment-100 cursor-not-allowed opacity-50"
          : dragOver
            ? "border-oxblood-600 bg-oxblood-50"
            : "border-ink-500/25 bg-parchment-50 hover:bg-parchment-100")
      }
    >
      <Upload size={24} className="text-ink-500" />
      <div className="text-center">
        <p className="font-display text-base text-ink-800">
          Drop PDFs here, or click to choose
        </p>
        <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          PDF files only · Multiple selection ok · 200 MB max each
        </p>
      </div>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        multiple
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          // reset so the same file can be re-picked if removed then re-added
          e.target.value = "";
        }}
        className="sr-only"
      />
    </label>
  );
});

// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  filledKeys,
  uploadPct,
}: {
  status: RowStatus;
  filledKeys?: number;
  uploadPct?: number;
}) {
  if (status === "queued")
    return (
      <span className="ml-chip">
        <Clock size={10} /> Queued
      </span>
    );
  if (status === "uploading")
    return (
      <span className="ml-chip ml-chip--accent">
        <Loader2 size={10} className="animate-spin" />
        {uploadPct !== undefined ? ` ${uploadPct}%` : " Uploading"}
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
  if (status === "published")
    return (
      <span className="ml-chip ml-chip--accent">
        <Send size={10} /> Published
      </span>
    );
  return (
    <span className="ml-chip ml-chip--accent">
      <AlertCircle size={10} /> Failed
    </span>
  );
}
