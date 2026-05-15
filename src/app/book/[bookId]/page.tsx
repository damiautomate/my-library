"use client";

import { useEffect, useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { BookOpen, Headphones, ExternalLink, Edit, FileText } from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Tag } from "@/components/ui/Tag";
import { getBook } from "@/lib/books";
import { useAuth } from "@/contexts/AuthContext";
import {
  LIFE_DOMAINS,
  LIFE_STAGES,
  READER_LEVELS,
  READING_MODES,
  CULTURAL_CONTEXTS,
  LANGUAGES,
  ROOMS,
} from "@/lib/taxonomy";
import type { Book } from "@/lib/types";

export default function BookDetailPage() {
  return (
    <AuthGuard>
      <Header />
      <BookDetailContent />
    </AuthGuard>
  );
}

function BookDetailContent() {
  const params = useParams<{ bookId: string }>();
  const bookId = params?.bookId;
  const { isAdmin } = useAuth();

  const [book, setBook] = useState<Book | null | undefined>(undefined);

  useEffect(() => {
    if (!bookId) return;
    getBook(bookId).then(setBook);
  }, [bookId]);

  if (book === undefined) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Pulling the volume…
        </p>
      </main>
    );
  }

  if (book === null) return notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      {/* Header band */}
      <header className="grid grid-cols-1 gap-10 border-b ml-hairline pb-10 md:grid-cols-12">
        {/* Cover */}
        <div className="md:col-span-4">
          <div className="aspect-[2/3] overflow-hidden rounded-sm border ml-hairline bg-parchment-200 shadow-paper-lg">
            {book.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={book.cover_url}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-ink-500/40">
                <BookOpen size={56} />
              </div>
            )}
          </div>
        </div>

        {/* Title block */}
        <div className="md:col-span-8">
          {book.rooms?.[0] && (
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
              {ROOMS[book.rooms[0]].label}
            </p>
          )}
          <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tightest md:text-5xl">
            {book.title}
          </h1>
          {book.subtitle && (
            <p className="mt-2 font-display text-xl italic text-ink-600">
              {book.subtitle}
            </p>
          )}
          <p className="mt-4 text-sm text-ink-700">
            By {book.authors?.join(", ")}
          </p>

          {/* Quick meta line */}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            {book.publisher && <span>{book.publisher}</span>}
            {book.publication_year && <span>{book.publication_year}</span>}
            {book.page_count && <span>{book.page_count} pages</span>}
            {book.estimated_reading_time_hours && (
              <span>~{book.estimated_reading_time_hours} hr read</span>
            )}
            {book.language && <span>{LANGUAGES[book.language] ?? book.language}</span>}
          </div>

          {/* Action row — Phase 2 will enable Read & Listen */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              disabled
              title="In-app reader arrives in Phase 2"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-sm border border-ink-500/30 bg-parchment-100 px-4 py-2 text-sm text-ink-500"
            >
              <BookOpen size={14} />
              Read inside (Phase 2)
            </button>
            {book.audio_summary_url && (
              <button
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-sm border border-ink-500/30 px-4 py-2 text-sm text-ink-500"
              >
                <Headphones size={14} />
                Listen (Phase 2)
              </button>
            )}
            {book.amazon_url && (
              <a
                href={book.amazon_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-ink-700 underline-offset-4 hover:underline"
              >
                <ExternalLink size={13} />
                Amazon
              </a>
            )}
            {book.external_url && (
              <a
                href={book.external_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-ink-700 underline-offset-4 hover:underline"
              >
                <ExternalLink size={13} />
                External
              </a>
            )}
            {isAdmin && (
              <Link
                href={`/admin/books/${book.id}/edit`}
                className="ml-auto inline-flex items-center gap-1.5 rounded-sm border border-forest-600/40 bg-forest-50 px-3 py-2 text-sm text-forest-600 hover:bg-forest-50/80"
              >
                <Edit size={13} />
                Edit
              </Link>
            )}
          </div>

          {book.status === "draft" && (
            <p className="mt-4 inline-block rounded-sm bg-ink-900/80 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-parchment-50">
              Draft — not yet visible to members
            </p>
          )}
        </div>
      </header>

      {/* Description */}
      {book.description && (
        <section className="grid grid-cols-1 gap-8 border-b ml-hairline py-10 md:grid-cols-12">
          <div className="md:col-span-3">
            <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-ink-600">
              About the book
            </h2>
          </div>
          <div className="md:col-span-9">
            <p className="ml-dropcap whitespace-pre-line text-base leading-relaxed text-ink-800">
              {book.description}
            </p>
          </div>
        </section>
      )}

      {/* Why this book */}
      {book.why_this_book && (
        <section className="grid grid-cols-1 gap-8 border-b ml-hairline py-10 md:grid-cols-12">
          <div className="md:col-span-3">
            <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
              Why this book
            </h2>
            <p className="mt-1 text-xs text-ink-500">— the curator</p>
          </div>
          <div className="md:col-span-9">
            <blockquote className="border-l-2 border-oxblood-600/50 pl-5 font-display text-xl leading-relaxed italic text-ink-800">
              {book.why_this_book}
            </blockquote>
          </div>
        </section>
      )}

      {/* Classification */}
      <section className="grid grid-cols-1 gap-8 border-b ml-hairline py-10 md:grid-cols-12">
        <div className="md:col-span-3">
          <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-ink-600">
            Classification
          </h2>
        </div>
        <div className="md:col-span-9 space-y-5">
          <ClassRow label="Rooms">
            {book.rooms?.map((r) => (
              <Tag key={r} tone="accent">
                {ROOMS[r].label}
              </Tag>
            ))}
          </ClassRow>
          <ClassRow label="Life Domains">
            {book.life_domains?.map((d) => (
              <Tag key={d}>{LIFE_DOMAINS[d]}</Tag>
            ))}
          </ClassRow>
          <ClassRow label="Life Stages">
            {book.life_stages?.map((s) => (
              <Tag key={s} tone="forest">
                {LIFE_STAGES[s]}
              </Tag>
            ))}
          </ClassRow>
          <ClassRow label="Reader Level">
            {book.reader_level && (
              <Tag tone="gold">{READER_LEVELS[book.reader_level]}</Tag>
            )}
          </ClassRow>
          <ClassRow label="Reading Modes">
            {book.reading_modes?.map((m) => (
              <Tag key={m}>{READING_MODES[m]}</Tag>
            ))}
          </ClassRow>
          <ClassRow label="Cultural Contexts">
            {book.cultural_contexts?.map((c) => (
              <Tag key={c}>{CULTURAL_CONTEXTS[c]}</Tag>
            ))}
          </ClassRow>
          {book.outcomes && book.outcomes.length > 0 && (
            <ClassRow label="Outcomes">
              {book.outcomes.map((o) => (
                <Tag key={o} tone="gold">
                  {o}
                </Tag>
              ))}
            </ClassRow>
          )}
          {book.fields && book.fields.length > 0 && (
            <ClassRow label="Fields">
              {book.fields.map((f) => (
                <Tag key={f}>{f}</Tag>
              ))}
            </ClassRow>
          )}
        </div>
      </section>

      {/* Identifiers */}
      <section className="grid grid-cols-1 gap-8 py-10 md:grid-cols-12">
        <div className="md:col-span-3">
          <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-ink-600">
            Identifiers
          </h2>
        </div>
        <div className="md:col-span-9 font-mono text-xs text-ink-700">
          <dl className="grid grid-cols-2 gap-y-2">
            {book.isbn_13 && (
              <>
                <dt className="text-ink-500">ISBN-13</dt>
                <dd>{book.isbn_13}</dd>
              </>
            )}
            {book.isbn_10 && (
              <>
                <dt className="text-ink-500">ISBN-10</dt>
                <dd>{book.isbn_10}</dd>
              </>
            )}
            <dt className="text-ink-500">Status</dt>
            <dd>
              <span className="inline-flex items-center gap-1.5">
                <FileText size={12} />
                {book.status}
              </span>
            </dd>
          </dl>
        </div>
      </section>
    </main>
  );
}

function ClassRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const arr = Array.isArray(children) ? children : [children];
  if (arr.filter(Boolean).length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[0.7rem] text-ink-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
