"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, notFound } from "next/navigation";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import {
  BookForm,
  EMPTY_BOOK_FORM,
  fromBook,
  toBookDoc,
  type BookFormValue,
} from "@/components/admin/BookForm";
import { Button } from "@/components/ui/Button";
import { ConversionActions } from "@/components/admin/ConversionActions";
import { ShareControl } from "@/components/admin/ShareControl";
import { getBook, updateBook, deleteBookForever } from "@/lib/books";
import type { Book, BookStatus } from "@/lib/types";

export default function EditBookPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <EditBookContent />
    </AuthGuard>
  );
}

function EditBookContent() {
  const params = useParams<{ bookId: string }>();
  const bookId = params?.bookId;
  const router = useRouter();

  const [book, setBook] = useState<Book | null | undefined>(undefined);
  const [value, setValue] = useState<BookFormValue>(EMPTY_BOOK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookId) return;
    getBook(bookId).then((b) => {
      setBook(b);
      if (b) setValue(fromBook(b));
    });
  }, [bookId]);

  async function handleSubmit(status: BookStatus) {
    if (!bookId) return;
    setError(null);
    setSaving(true);
    try {
      await updateBook(bookId, { ...toBookDoc(value), status });
      router.push(`/book/${bookId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!bookId) return;
    if (
      !confirm(
        "Delete this book FOREVER? This cannot be undone. Use Archive if you might want it back.",
      )
    )
      return;
    await deleteBookForever(bookId);
    router.push("/admin/books");
  }

  if (book === undefined) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Pulling the volume…
        </p>
      </main>
    );
  }
  if (book === null) return notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 pb-32 pt-12">
      <header className="mb-8 flex items-baseline justify-between border-b ml-hairline pb-4">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
            Admin · Edit
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tightest">
            {book.title}
          </h1>
        </div>
        <Button variant="danger" onClick={handleDelete}>
          Delete forever
        </Button>
      </header>

      {error && (
        <div className="mb-5 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-4 py-3 text-sm text-oxblood-700">
          {error}
        </div>
      )}

      {book && (
        <ConversionActions
          book={book}
          onChanged={() => {
            if (bookId) getBook(bookId).then((b) => b && setBook(b));
          }}
        />
      )}

      {book && book.status === "published" && (
        <ShareControl
          book={book}
          onChanged={() => {
            if (bookId) getBook(bookId).then((b) => b && setBook(b));
          }}
        />
      )}

      <BookForm
        bookId={bookId}
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        saving={saving}
        submitLabel="Save changes"
      />
    </main>
  );
}
