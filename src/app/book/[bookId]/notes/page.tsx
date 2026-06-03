"use client";

import { useEffect, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Notebook } from "@/components/notes/Notebook";
import { useAuth } from "@/contexts/AuthContext";
import { getBook } from "@/lib/books";
import type { Book } from "@/lib/types";

export default function NotebookPage() {
  return (
    <AuthGuard>
      <Header />
      <NotebookContent />
    </AuthGuard>
  );
}

function NotebookContent() {
  const params = useParams<{ bookId: string }>();
  const bookId = params?.bookId;
  const { firebaseUser } = useAuth();
  const [book, setBook] = useState<Book | null | undefined>(undefined);

  useEffect(() => {
    if (!bookId) return;
    getBook(bookId).then(setBook);
  }, [bookId]);

  if (book === undefined) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Opening your notebook…
        </p>
      </main>
    );
  }
  if (book === null) return notFound();
  if (!firebaseUser) return null;

  return <Notebook book={book} userId={firebaseUser.uid} />;
}
