"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  Headphones,
  ExternalLink,
  Edit,
  FileText,
  Download,
  Bookmark,
  Pause,
  Play,
  CheckCircle2,
  X as XIcon,
  Star,
} from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Tag } from "@/components/ui/Tag";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Input";
import { ReadingProgress } from "@/components/library/ReadingProgress";
import { getBook } from "@/lib/books";
import { useAuth } from "@/contexts/AuthContext";
import {
  setStatus,
  setRatingAndNotes,
  watchProgress,
  saveNotes,
  removeHighlight,
} from "@/lib/progress";
import { downloadUrl } from "@/lib/cloudinary";
import {
  LIFE_DOMAINS,
  LIFE_STAGES,
  READER_LEVELS,
  READING_MODES,
  CULTURAL_CONTEXTS,
  LANGUAGES,
  ROOMS,
} from "@/lib/taxonomy";
import type {
  Book,
  Highlight,
  ReadingProgressDoc,
  ReadingStatus,
} from "@/lib/types";

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
  const search = useSearchParams();
  const router = useRouter();
  const bookId = params?.bookId;
  const { isAdmin, firebaseUser } = useAuth();

  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [progress, setProgress] = useState<ReadingProgressDoc | null>(null);
  const [showFinish, setShowFinish] = useState(false);

  useEffect(() => {
    if (!bookId) return;
    getBook(bookId).then(setBook);
  }, [bookId]);

  useEffect(() => {
    if (!firebaseUser || !bookId) return;
    return watchProgress(firebaseUser.uid, bookId, setProgress);
  }, [firebaseUser, bookId]);

  // ?finish=1 from the reader's near-100% nudge opens the modal automatically
  useEffect(() => {
    if (search.get("finish") === "1") setShowFinish(true);
  }, [search]);

  const handleShelf = useCallback(
    async (next: ReadingStatus) => {
      if (!firebaseUser || !bookId) return;
      await setStatus(firebaseUser.uid, bookId, next);
    },
    [firebaseUser, bookId],
  );

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

  const hasReadable = !!(book.pdf_url || book.epub_url);
  const hasAudio = !!book.audio_summary_url;

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      {/* Header band */}
      <header className="grid grid-cols-1 gap-10 border-b ml-hairline pb-10 md:grid-cols-12">
        {/* Cover + progress + shelf actions */}
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

          {/* Reading progress card */}
          {progress && (
            <div className="mt-4">
              <ReadingProgress progress={progress} />
            </div>
          )}

          {/* Shelf controls */}
          <div className="mt-4 grid grid-cols-2 gap-1.5">
            <ShelfBtn
              label="Want to read"
              icon={<Bookmark size={11} />}
              active={progress?.status === "want_to_read"}
              onClick={() => handleShelf("want_to_read")}
            />
            <ShelfBtn
              label="Currently reading"
              icon={<BookOpen size={11} />}
              active={progress?.status === "currently_reading"}
              onClick={() => handleShelf("currently_reading")}
            />
            <ShelfBtn
              label="Pause"
              icon={<Pause size={11} />}
              active={progress?.status === "paused"}
              onClick={() => handleShelf("paused")}
            />
            <ShelfBtn
              label="Finish…"
              icon={<CheckCircle2 size={11} />}
              active={progress?.status === "finished"}
              onClick={() => setShowFinish(true)}
              tone="forest"
            />
          </div>
        </div>

        {/* Title block + actions */}
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

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            {book.publisher && <span>{book.publisher}</span>}
            {book.publication_year && <span>{book.publication_year}</span>}
            {book.page_count && <span>{book.page_count} pages</span>}
            {book.estimated_reading_time_hours && (
              <span>~{book.estimated_reading_time_hours} hr read</span>
            )}
            {book.language && (
              <span>{LANGUAGES[book.language] ?? book.language}</span>
            )}
          </div>

          {/* Action row */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {hasReadable && (
              <Link
                href={`/book/${book.id}/read${book.pdf_url ? "?mode=pdf" : "?mode=epub"}`}
              >
                <Button variant="primary">
                  <BookOpen size={14} />
                  {progress?.current_page || progress?.current_cfi
                    ? "Resume reading"
                    : "Read inside"}
                </Button>
              </Link>
            )}
            {hasAudio && (
              <Link href={`/book/${book.id}/read?mode=audio`}>
                <Button variant="outline">
                  <Headphones size={14} />
                  {progress?.current_audio_seconds ? "Resume audio" : "Listen"}
                </Button>
              </Link>
            )}
            {book.pdf_url && (
              <a
                href={downloadUrl(
                  book.pdf_url,
                  `${book.title.replace(/[^\w]+/g, "_")}.pdf`,
                )}
                className="inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm text-ink-700 underline-offset-4 hover:underline"
              >
                <Download size={13} />
                PDF
              </a>
            )}
            {book.epub_url && (
              <a
                href={downloadUrl(
                  book.epub_url,
                  `${book.title.replace(/[^\w]+/g, "_")}.epub`,
                )}
                className="inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-sm text-ink-700 underline-offset-4 hover:underline"
              >
                <Download size={13} />
                EPUB
              </a>
            )}
            {book.amazon_url && (
              <a
                href={book.amazon_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-2 text-sm text-ink-700 underline-offset-4 hover:underline"
              >
                <ExternalLink size={13} />
                Amazon
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

      {/* Reader's notes + highlights (member-private) */}
      {firebaseUser && (
        <ReaderNotesSection
          userId={firebaseUser.uid}
          bookId={book.id}
          progress={progress}
        />
      )}

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

      {/* Finish modal */}
      <FinishModal
        open={showFinish}
        onClose={() => {
          setShowFinish(false);
          if (search.get("finish")) router.replace(`/book/${bookId}`);
        }}
        existing={progress}
        onSubmit={async (rating, notes) => {
          if (!firebaseUser || !bookId) return;
          await setStatus(firebaseUser.uid, bookId, "finished");
          await setRatingAndNotes(firebaseUser.uid, bookId, rating, notes);
        }}
      />
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

function ShelfBtn({
  label,
  icon,
  active,
  onClick,
  tone = "neutral",
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  tone?: "neutral" | "forest";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-xs transition-colors " +
        (active
          ? tone === "forest"
            ? "border-forest-600/50 bg-forest-50 text-forest-600"
            : "border-oxblood-600/50 bg-oxblood-50 text-oxblood-700"
          : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
      }
    >
      {icon}
      {label}
    </button>
  );
}

function FinishModal({
  open,
  onClose,
  existing,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  existing: ReadingProgressDoc | null;
  onSubmit: (rating: number | null, notes: string | null) => Promise<void>;
}) {
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRating(existing?.rating ?? null);
      setNotes(existing?.notes ?? "");
    }
  }, [open, existing]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSubmit(rating, notes.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Close the book">
      <div className="space-y-5">
        <p className="text-sm text-ink-700">
          You've finished this book. Leave a rating and a brief closing note for
          your future self.
        </p>

        <div>
          <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
            Rating (optional)
          </p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                className="p-1 text-gold-500 hover:text-gold-600"
                aria-label={`${n} stars`}
              >
                <Star
                  size={22}
                  fill={rating && n <= rating ? "currentColor" : "transparent"}
                  className={rating && n <= rating ? "" : "opacity-40"}
                />
              </button>
            ))}
            {rating !== null && (
              <button
                type="button"
                onClick={() => setRating(null)}
                className="ml-2 text-ink-500 hover:text-ink-900"
                aria-label="Clear rating"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
        </div>

        <Textarea
          label="Closing note"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="What did this book change in you?"
        />

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Mark finished"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// ReaderNotesSection — private notes + highlights for the signed-in member
// ----------------------------------------------------------------------------

function ReaderNotesSection({
  userId,
  bookId,
  progress,
}: {
  userId: string;
  bookId: string;
  progress: ReadingProgressDoc | null;
}) {
  const [notes, setNotesState] = useState(progress?.notes ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local notes in sync if a different tab updates them
  useEffect(() => {
    setNotesState(progress?.notes ?? "");
  }, [progress?.notes]);

  function onNotesChange(v: string) {
    setNotesState(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveNotes(userId, bookId, v);
        setSavedAt(Date.now());
      } finally {
        setSaving(false);
      }
    }, 800);
  }

  async function handleRemoveHighlight(h: Highlight) {
    if (!confirm("Remove this highlight?")) return;
    await removeHighlight(userId, bookId, h);
  }

  const highlights = progress?.highlights ?? [];

  return (
    <section className="grid grid-cols-1 gap-8 border-b ml-hairline py-10 md:grid-cols-12">
      <div className="md:col-span-3">
        <h2 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Reader's notes
        </h2>
        <p className="mt-1 text-xs text-ink-500">Private to you</p>
      </div>
      <div className="md:col-span-9 space-y-6">
        {/* Notes */}
        <div>
          <Textarea
            label="Notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={5}
            placeholder="What is this book teaching you? Quotes you want to revisit? Action items?"
          />
          <p className="mt-1 h-4 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            {saving
              ? "Saving…"
              : savedAt
                ? `Saved · ${new Date(savedAt).toLocaleTimeString()}`
                : ""}
          </p>
        </div>

        {/* Highlights */}
        <div>
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-700">
              Highlights ({highlights.length})
            </h3>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
              Capture from the reader
            </p>
          </div>

          {highlights.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">
              No highlights yet. Open the reader, select text, and choose
              "Save highlight" to collect quotes here.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {highlights
                .slice()
                .sort((a, b) => {
                  const at = (a.created_at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
                  const bt = (b.created_at as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
                  return bt - at;
                })
                .map((h) => (
                  <li
                    key={h.id}
                    className="group rounded-sm border-l-2 border-gold-500 bg-parchment-100/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <blockquote className="font-display text-base italic leading-relaxed text-ink-800">
                        “{h.text}”
                      </blockquote>
                      <button
                        type="button"
                        onClick={() => handleRemoveHighlight(h)}
                        className="rounded-sm p-1 text-ink-500 opacity-0 transition-opacity hover:bg-parchment-200 hover:text-oxblood-700 group-hover:opacity-100"
                        aria-label="Remove highlight"
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                    <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
                      {h.page !== undefined && `Page ${h.page} · `}
                      {(h.created_at as { toDate?: () => Date } | undefined)?.toDate?.().toLocaleDateString()}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
