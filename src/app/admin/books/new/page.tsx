"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import {
  BookForm,
  EMPTY_BOOK_FORM,
  toBookDoc,
  type BookFormValue,
} from "@/components/admin/BookForm";
import { useAuth } from "@/contexts/AuthContext";
import { createBookWithId, newBookId } from "@/lib/books";
import type { BookStatus } from "@/lib/types";

export default function NewBookPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <NewBookContent />
    </AuthGuard>
  );
}

function NewBookContent() {
  const router = useRouter();
  const { firebaseUser } = useAuth();

  // Pre-allocate an ID before render so file uploaders have something to target.
  // useMemo keeps the same ID across re-renders within this page lifetime.
  const bookId = useMemo(() => newBookId(), []);

  const [value, setValue] = useState<BookFormValue>(EMPTY_BOOK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(status: BookStatus) {
    setError(null);
    if (!firebaseUser) {
      setError("Not signed in");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...toBookDoc(value), status };
      await createBookWithId(bookId, payload, firebaseUser.uid);
      router.push(`/book/${bookId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save the book.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 pb-32 pt-12">
      <header className="mb-8 flex items-baseline justify-between border-b ml-hairline pb-4">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
            Admin · New book
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tightest">
            Acquire a new volume
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-600">
            Upload files now — they'll land in the right Cloudinary folder for
            this book. Save as draft to come back later, or publish straight away.
          </p>
          <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
            ID · {bookId}
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-5 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-4 py-3 text-sm text-oxblood-700">
          {error}
        </div>
      )}

      <BookForm
        bookId={bookId}
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        saving={saving}
        submitLabel="Save book"
      />
    </main>
  );
}
