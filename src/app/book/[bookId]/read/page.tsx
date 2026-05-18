"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams, notFound } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileText, Headphones } from "lucide-react";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { getBook } from "@/lib/books";
import { proxyFileUrl } from "@/lib/cloudinary";
import { getProgress } from "@/lib/progress";
import type { Book, ReadingProgressDoc } from "@/lib/types";

// react-pdf and react-reader touch window/Worker APIs; ensure they only load
// in the browser by dynamically importing with ssr: false.
const PDFReader = dynamic(
  () => import("@/components/readers/PDFReader").then((m) => m.PDFReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="PDF" /> },
);

const EPUBReader = dynamic(
  () => import("@/components/readers/EPUBReader").then((m) => m.EPUBReader),
  { ssr: false, loading: () => <ReaderSkeleton kind="EPUB" /> },
);

const AudioPlayer = dynamic(
  () => import("@/components/readers/AudioPlayer").then((m) => m.AudioPlayer),
  { ssr: false, loading: () => <ReaderSkeleton kind="audio" /> },
);

function ReaderSkeleton({ kind }: { kind: string }) {
  return (
    <div className="flex h-[60vh] items-center justify-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
      Loading {kind} reader…
    </div>
  );
}

type Mode = "pdf" | "epub" | "audio";

export default function ReadPage() {
  return (
    <AuthGuard>
      <ReadContent />
    </AuthGuard>
  );
}

function ReadContent() {
  const params = useParams<{ bookId: string }>();
  const bookId = params?.bookId;
  const search = useSearchParams();
  const requestedMode = search.get("mode") as Mode | null;
  const { firebaseUser } = useAuth();
  const router = useRouter();

  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [progress, setProgress] = useState<ReadingProgressDoc | null>(null);
  const [livePct, setLivePct] = useState<number | null>(null);
  const [proxyUrls, setProxyUrls] = useState<Partial<Record<Mode, string>>>({});

  // Resolve same-origin proxy URLs for each available format. Recomputed any
  // time the book or signed-in user changes (since the URL embeds an ID token).
  useEffect(() => {
    if (!book || !firebaseUser) return;
    let cancelled = false;
    (async () => {
      const next: Partial<Record<Mode, string>> = {};
      if (book.pdf_url) next.pdf = await proxyFileUrl(book.id, "pdf");
      if (book.epub_url) next.epub = await proxyFileUrl(book.id, "epub");
      if (book.audio_summary_url)
        next.audio = await proxyFileUrl(book.id, "audio");
      if (!cancelled) setProxyUrls(next);
    })().catch((err) => console.warn("[read] proxyFileUrl failed", err));
    return () => {
      cancelled = true;
    };
  }, [book, firebaseUser]);

  useEffect(() => {
    if (!bookId) return;
    getBook(bookId).then(setBook);
  }, [bookId]);

  useEffect(() => {
    if (!firebaseUser || !bookId) return;
    getProgress(firebaseUser.uid, bookId).then((p) => {
      setProgress(p);
      setLivePct(p?.current_percent ?? null);
    });
  }, [firebaseUser, bookId]);

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
  if (!firebaseUser) return null;

  // Choose available modes
  const available: Mode[] = [];
  if (book.pdf_url) available.push("pdf");
  if (book.epub_url) available.push("epub");
  if (book.audio_summary_url) available.push("audio");

  if (available.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <BackBar bookId={bookId!} title={book.title} />
        <div className="ml-card mt-8 p-8 text-center">
          <p className="font-display text-2xl">Nothing to read yet.</p>
          <p className="mt-3 text-sm text-ink-600">
            The curator hasn't uploaded a PDF, EPUB, or audio summary for this
            book.
          </p>
        </div>
      </main>
    );
  }

  const mode: Mode = requestedMode && available.includes(requestedMode)
    ? requestedMode
    : available[0];

  return (
    <main className="mx-auto max-w-6xl px-6 pb-16 pt-6">
      <BackBar bookId={bookId!} title={book.title} pct={livePct} />

      {/* Mode switcher when multiple available */}
      {available.length > 1 && (
        <div className="my-4 flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.15em]">
          {available.map((m) => (
            <button
              key={m}
              onClick={() =>
                router.replace(`/book/${bookId}/read?mode=${m}`, { scroll: false })
              }
              className={
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 " +
                (mode === m
                  ? "border-oxblood-600/60 bg-oxblood-50 text-oxblood-700"
                  : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100")
              }
            >
              {m === "pdf" && <FileText size={11} />}
              {m === "epub" && <BookOpen size={11} />}
              {m === "audio" && <Headphones size={11} />}
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {mode === "pdf" && proxyUrls.pdf && (
          <PDFReader
            url={proxyUrls.pdf}
            userId={firebaseUser.uid}
            bookId={book.id}
            initialPage={progress?.current_page}
            onPercentChange={setLivePct}
          />
        )}
        {mode === "epub" && proxyUrls.epub && (
          <EPUBReader
            url={proxyUrls.epub}
            userId={firebaseUser.uid}
            bookId={book.id}
            initialCfi={progress?.current_cfi}
            onPercentChange={setLivePct}
          />
        )}
        {mode === "audio" && proxyUrls.audio && (
          <AudioPlayer
            url={proxyUrls.audio}
            userId={firebaseUser.uid}
            bookId={book.id}
            initialSeconds={progress?.current_audio_seconds}
            durationHint={book.audio_summary_duration_seconds}
            onPercentChange={setLivePct}
          />
        )}
        {!proxyUrls[mode] && (
          <p className="py-10 text-center font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Preparing the {mode} reader…
          </p>
        )}
      </div>

      {/* Mark-as-finished prompt */}
      {livePct !== null && livePct >= 95 && progress?.status !== "finished" && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-sm border border-forest-600/40 bg-forest-50 px-5 py-4">
          <div>
            <p className="font-display text-lg text-forest-600">
              You're nearly through. Mark as finished?
            </p>
            <p className="mt-1 text-xs text-ink-600">
              You'll be prompted for a rating and a closing note.
            </p>
          </div>
          <Link href={`/book/${bookId}?finish=1`}>
            <Button variant="primary">Mark finished</Button>
          </Link>
        </div>
      )}
    </main>
  );
}

function BackBar({
  bookId,
  title,
  pct,
}: {
  bookId: string;
  title: string;
  pct?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b ml-hairline pb-3">
      <Link
        href={`/book/${bookId}`}
        className="flex items-center gap-1.5 text-sm text-ink-700 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        <span className="font-display text-base">{title}</span>
      </Link>
      {pct !== null && pct !== undefined && (
        <div className="flex items-center gap-2">
          <div className="h-1 w-40 overflow-hidden rounded-full bg-parchment-200">
            <div
              className="h-full bg-oxblood-600"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-xs text-ink-700">{pct}%</span>
        </div>
      )}
    </div>
  );
}
