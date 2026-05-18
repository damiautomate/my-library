"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { BookGrid } from "@/components/library/BookGrid";
import { ROOMS, type Room } from "@/lib/taxonomy";
import { listBooks } from "@/lib/books";
import type { Book } from "@/lib/types";

export default function RoomPage() {
  return (
    <AuthGuard>
      <Header />
      <RoomContent />
    </AuthGuard>
  );
}

function RoomContent() {
  const params = useParams<{ roomId: string }>();
  const roomId = params?.roomId as Room | undefined;

  const room = roomId && roomId in ROOMS ? ROOMS[roomId] : null;
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) return;
    listBooks({ status: "published", room: roomId })
      .then(setBooks)
      .finally(() => setLoading(false));
  }, [roomId]);

  const sorted = useMemo(() => books, [books]);

  if (!roomId || !room) return notFound();

  return (
    <main className="mx-auto max-w-7xl px-6 pb-24">
      {/* Hero band */}
      <section className="border-b ml-hairline py-14">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          A room in the library
        </p>
        <h1 className="mt-4 font-display text-5xl leading-[1] tracking-tightest md:text-6xl">
          {room.label}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-ink-700">{room.desc}</p>
      </section>

      <section className="pt-10">
        {loading ? (
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-ink-500">
            Walking to the shelves…
          </p>
        ) : (
          <BookGrid
            books={sorted}
            emptyMessage="This room is still being arranged."
          />
        )}
      </section>
    </main>
  );
}
