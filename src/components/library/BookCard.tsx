"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { Book } from "@/lib/types";
import { roomLabel } from "@/lib/taxonomy";

interface BookCardProps {
  book: Book;
}

export function BookCard({ book }: BookCardProps) {
  const room = book.rooms?.[0];
  return (
    <Link
      href={`/book/${book.id}`}
      className="group flex flex-col overflow-hidden rounded-sm border ml-hairline bg-parchment-50 shadow-paper transition-all hover:-translate-y-0.5 hover:shadow-paper-lg"
    >
      {/* Cover */}
      <div className="relative aspect-[2/3] overflow-hidden bg-parchment-200">
        {book.cover_url ? (
          // Using a plain img tag so external Cloudinary/Google Books URLs
          // work without the Next/Image domain dance for arbitrary covers.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.cover_url}
            alt={book.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-500/40">
            <BookOpen size={40} />
          </div>
        )}
        {book.status === "draft" && (
          <div className="absolute right-2 top-2 rounded-sm bg-ink-900/70 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-parchment-50">
            Draft
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 py-3">
        <h3 className="font-display text-base leading-tight tracking-tight text-ink-900 line-clamp-2">
          {book.title}
        </h3>
        <p className="text-xs text-ink-600 line-clamp-1">
          {book.authors?.join(", ")}
        </p>
        {room && (
          <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-oxblood-700">
            {roomLabel(room)}
          </p>
        )}
      </div>
    </Link>
  );
}
