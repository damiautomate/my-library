"use client";

import { useState } from "react";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { FileUploader } from "./FileUploader";
import {
  ClassificationPicker,
  EMPTY_CLASSIFICATION,
  type ClassificationValue,
} from "./ClassificationPicker";
import { LANGUAGES } from "@/lib/taxonomy";
import type { Book, BookDoc, BookStatus } from "@/lib/types";

export interface BookFormValue extends ClassificationValue {
  title: string;
  subtitle: string;
  authors: string; // comma-separated input
  description: string;
  cover_url: string;
  cover_public_id: string;
  isbn_10: string;
  isbn_13: string;
  publisher: string;
  publication_year: string;
  language: string;
  page_count: string;
  estimated_reading_time_hours: string;
  why_this_book: string;
  amazon_url: string;
  external_url: string;
  status: BookStatus;
  // File slots — set when uploads complete
  pdf_url: string;
  pdf_public_id: string;
  epub_url: string;
  epub_public_id: string;
  audio_summary_url: string;
  audio_summary_public_id: string;
  audio_summary_duration_seconds: number | null;
}

export const EMPTY_BOOK_FORM: BookFormValue = {
  title: "",
  subtitle: "",
  authors: "",
  description: "",
  cover_url: "",
  cover_public_id: "",
  isbn_10: "",
  isbn_13: "",
  publisher: "",
  publication_year: "",
  language: "en",
  page_count: "",
  estimated_reading_time_hours: "",
  why_this_book: "",
  amazon_url: "",
  external_url: "",
  status: "draft",
  pdf_url: "",
  pdf_public_id: "",
  epub_url: "",
  epub_public_id: "",
  audio_summary_url: "",
  audio_summary_public_id: "",
  audio_summary_duration_seconds: null,
  ...EMPTY_CLASSIFICATION,
};

export function fromBook(book: Book): BookFormValue {
  return {
    title: book.title ?? "",
    subtitle: book.subtitle ?? "",
    authors: (book.authors ?? []).join(", "),
    description: book.description ?? "",
    cover_url: book.cover_url ?? "",
    cover_public_id: "", // not stored separately in Phase 1; ok if blank
    isbn_10: book.isbn_10 ?? "",
    isbn_13: book.isbn_13 ?? "",
    publisher: book.publisher ?? "",
    publication_year: book.publication_year?.toString() ?? "",
    language: book.language ?? "en",
    page_count: book.page_count?.toString() ?? "",
    estimated_reading_time_hours:
      book.estimated_reading_time_hours?.toString() ?? "",
    why_this_book: book.why_this_book ?? "",
    amazon_url: book.amazon_url ?? "",
    external_url: book.external_url ?? "",
    status: book.status ?? "draft",
    pdf_url: book.pdf_url ?? "",
    pdf_public_id: book.pdf_public_id ?? "",
    epub_url: book.epub_url ?? "",
    epub_public_id: book.epub_public_id ?? "",
    audio_summary_url: book.audio_summary_url ?? "",
    audio_summary_public_id: book.audio_summary_public_id ?? "",
    audio_summary_duration_seconds: book.audio_summary_duration_seconds ?? null,
    life_domains: book.life_domains ?? [],
    life_stages: book.life_stages ?? [],
    rooms: book.rooms ?? [],
    reader_level: book.reader_level ?? "intermediate",
    reading_modes: book.reading_modes ?? [],
    cultural_contexts: book.cultural_contexts ?? [],
    outcomes: book.outcomes ?? [],
    fields: book.fields ?? [],
  };
}

/** Convert form value into a partial BookDoc ready to persist. */
export function toBookDoc(v: BookFormValue): Partial<BookDoc> {
  const authors = v.authors
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const partial: Partial<BookDoc> = {
    title: v.title.trim(),
    subtitle: v.subtitle.trim() || undefined,
    authors,
    description: v.description.trim() || undefined,
    cover_url: v.cover_url.trim() || undefined,
    isbn_10: v.isbn_10.replace(/\D/g, "") || undefined,
    isbn_13: v.isbn_13.replace(/\D/g, "") || undefined,
    publisher: v.publisher.trim() || undefined,
    publication_year: v.publication_year
      ? Number(v.publication_year)
      : undefined,
    language: v.language || "en",
    page_count: v.page_count ? Number(v.page_count) : undefined,
    estimated_reading_time_hours: v.estimated_reading_time_hours
      ? Number(v.estimated_reading_time_hours)
      : undefined,
    why_this_book: v.why_this_book.trim() || undefined,
    amazon_url: v.amazon_url.trim() || undefined,
    external_url: v.external_url.trim() || undefined,
    pdf_url: v.pdf_url || undefined,
    pdf_public_id: v.pdf_public_id || undefined,
    epub_url: v.epub_url || undefined,
    epub_public_id: v.epub_public_id || undefined,
    audio_summary_url: v.audio_summary_url || undefined,
    audio_summary_public_id: v.audio_summary_public_id || undefined,
    audio_summary_duration_seconds:
      v.audio_summary_duration_seconds ?? undefined,
    life_domains: v.life_domains,
    life_stages: v.life_stages,
    rooms: v.rooms,
    reader_level: v.reader_level,
    reading_modes: v.reading_modes,
    cultural_contexts: v.cultural_contexts,
    outcomes: v.outcomes,
    fields: v.fields,
    pairs_with: [],
    parent_books: [],
    child_books: [],
    status: v.status,
  };

  // Strip undefined so Firestore doesn't blow up
  return Object.fromEntries(
    Object.entries(partial).filter(([, val]) => val !== undefined),
  ) as Partial<BookDoc>;
}

interface BookFormProps {
  value: BookFormValue;
  onChange: (next: BookFormValue) => void;
  onSubmit: (status: BookStatus) => Promise<void> | void;
  saving?: boolean;
  submitLabel?: string;
  /** The (pre-allocated or existing) book document ID — required for file uploads. */
  bookId: string;
}

export function BookForm({
  value,
  onChange,
  onSubmit,
  saving = false,
  submitLabel = "Save book",
  bookId,
}: BookFormProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof BookFormValue, string>>>(
    {},
  );

  function set<K extends keyof BookFormValue>(key: K, v: BookFormValue[K]) {
    onChange({ ...value, [key]: v });
  }

  function setClassification(c: ClassificationValue) {
    onChange({ ...value, ...c });
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!value.title.trim()) next.title = "Title is required";
    if (!value.authors.trim()) next.authors = "At least one author is required";
    if (value.rooms.length === 0)
      next.rooms = "Pick at least one room so the book can be shelved";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(status: BookStatus) {
    if (!validate()) return;
    await onSubmit(status);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Core metadata */}
      <section className="ml-card p-6">
        <header className="mb-5 flex items-baseline justify-between border-b ml-hairline pb-3">
          <h2 className="font-display text-xl">Core metadata</h2>
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            Required
          </span>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Title"
              value={value.title}
              onChange={(e) => set("title", e.target.value)}
              error={errors.title}
              placeholder="Atomic Habits"
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Subtitle"
              value={value.subtitle}
              onChange={(e) => set("subtitle", e.target.value)}
              placeholder="An Easy & Proven Way to Build Good Habits…"
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Authors (comma-separated)"
              value={value.authors}
              onChange={(e) => set("authors", e.target.value)}
              error={errors.authors}
              placeholder="James Clear"
            />
          </div>
          <div className="md:col-span-2">
            <Textarea
              label="Description"
              value={value.description}
              onChange={(e) => set("description", e.target.value)}
              rows={4}
            />
          </div>
          <Input
            label="ISBN-13"
            value={value.isbn_13}
            onChange={(e) => set("isbn_13", e.target.value)}
            placeholder="9780735211292"
          />
          <Input
            label="ISBN-10"
            value={value.isbn_10}
            onChange={(e) => set("isbn_10", e.target.value)}
            placeholder="0735211299"
          />
          <Input
            label="Publisher"
            value={value.publisher}
            onChange={(e) => set("publisher", e.target.value)}
          />
          <Input
            label="Publication year"
            type="number"
            value={value.publication_year}
            onChange={(e) => set("publication_year", e.target.value)}
          />
          <Select
            label="Language"
            value={value.language}
            onChange={(e) => set("language", e.target.value)}
          >
            {Object.entries(LANGUAGES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input
            label="Page count"
            type="number"
            value={value.page_count}
            onChange={(e) => set("page_count", e.target.value)}
          />
          <Input
            label="Estimated reading time (hours)"
            type="number"
            value={value.estimated_reading_time_hours}
            onChange={(e) => set("estimated_reading_time_hours", e.target.value)}
          />
        </div>
      </section>

      {/* Files */}
      <section className="ml-card p-6">
        <header className="mb-5 flex items-baseline justify-between border-b ml-hairline pb-3">
          <h2 className="font-display text-xl">Files</h2>
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            Uploaded directly to Cloudinary
          </span>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              Cover image
            </label>
            <FileUploader
              kind="cover"
              bookId={bookId}
              url={value.cover_url}
              publicId={value.cover_public_id}
              onChange={(r) =>
                onChange({
                  ...value,
                  cover_url: r?.secure_url ?? "",
                  cover_public_id: r?.public_id ?? "",
                })
              }
            />
            {!value.cover_url && (
              <div className="mt-2">
                <Input
                  label="…or paste an external cover URL"
                  value={value.cover_url}
                  onChange={(e) => set("cover_url", e.target.value)}
                  placeholder="https://books.google.com/…"
                />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              PDF
            </label>
            <FileUploader
              kind="pdf"
              bookId={bookId}
              url={value.pdf_url}
              publicId={value.pdf_public_id}
              onChange={(r) =>
                onChange({
                  ...value,
                  pdf_url: r?.secure_url ?? "",
                  pdf_public_id: r?.public_id ?? "",
                })
              }
            />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              EPUB
            </label>
            <FileUploader
              kind="epub"
              bookId={bookId}
              url={value.epub_url}
              publicId={value.epub_public_id}
              onChange={(r) =>
                onChange({
                  ...value,
                  epub_url: r?.secure_url ?? "",
                  epub_public_id: r?.public_id ?? "",
                })
              }
            />
          </div>

          <div>
            <label className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
              Audio summary
            </label>
            <FileUploader
              kind="audio"
              bookId={bookId}
              url={value.audio_summary_url}
              publicId={value.audio_summary_public_id}
              onChange={(r) =>
                onChange({
                  ...value,
                  audio_summary_url: r?.secure_url ?? "",
                  audio_summary_public_id: r?.public_id ?? "",
                  audio_summary_duration_seconds: r?.duration
                    ? Math.round(r.duration)
                    : null,
                })
              }
            />
          </div>
        </div>
      </section>

      {/* Classification */}
      <section>
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Classification</h2>
          {errors.rooms && (
            <span className="text-xs text-oxblood-700">{errors.rooms}</span>
          )}
        </header>
        <ClassificationPicker
          value={{
            life_domains: value.life_domains,
            life_stages: value.life_stages,
            rooms: value.rooms,
            reader_level: value.reader_level,
            reading_modes: value.reading_modes,
            cultural_contexts: value.cultural_contexts,
            outcomes: value.outcomes,
            fields: value.fields,
          }}
          onChange={setClassification}
        />
      </section>

      {/* Curator voice + external links */}
      <section className="ml-card p-6">
        <header className="mb-5 border-b ml-hairline pb-3">
          <h2 className="font-display text-xl">Curator note</h2>
        </header>
        <Textarea
          label="Why this book"
          value={value.why_this_book}
          onChange={(e) => set("why_this_book", e.target.value)}
          rows={5}
          hint="Damilare's personal note on why this book matters. Markdown OK."
        />
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Amazon URL"
            value={value.amazon_url}
            onChange={(e) => set("amazon_url", e.target.value)}
          />
          <Input
            label="External URL"
            value={value.external_url}
            onChange={(e) => set("external_url", e.target.value)}
          />
        </div>
      </section>

      {/* Submit row */}
      <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t ml-hairline bg-parchment-50/95 px-6 py-4 backdrop-blur-sm">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          {value.status === "published" ? "Currently published" : "Currently draft"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => handleSubmit("draft")}
            disabled={saving}
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            onClick={() => handleSubmit("published")}
            disabled={saving}
          >
            {saving ? "Saving…" : `${submitLabel} & publish`}
          </Button>
        </div>
      </div>
    </div>
  );
}
