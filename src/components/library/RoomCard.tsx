"use client";

import Link from "next/link";
import {
  Anchor,
  Baby,
  Compass,
  Cross,
  Coins,
  Crown,
  Hammer,
  Heart,
  LucideIcon,
  ScrollText,
  Telescope,
  Trees,
} from "lucide-react";
import { ROOMS, type Room } from "@/lib/taxonomy";

const ICONS: Record<string, LucideIcon> = {
  Compass,
  Anchor,
  Hammer,
  Coins,
  Cross,
  Heart,
  Crown,
  Telescope,
  Trees,
  ScrollText,
  Baby,
};

interface RoomCardProps {
  roomKey: Room;
  count: number;
  size?: "1x1" | "2x1" | "1x2";
}

export function RoomCard({ roomKey, count, size = "1x1" }: RoomCardProps) {
  const room = ROOMS[roomKey];
  const Icon = ICONS[room.icon] ?? Compass;

  const sizeClass =
    size === "2x1"
      ? "md:col-span-2"
      : size === "1x2"
        ? "md:row-span-2"
        : "";

  return (
    <Link
      href={`/library/room/${roomKey}`}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-sm border ml-hairline bg-parchment-50 p-6 shadow-paper transition-all hover:bg-parchment-100 hover:shadow-paper-lg ${sizeClass}`}
    >
      <div className="flex items-start justify-between">
        <div className="rounded-full border ml-hairline bg-parchment-100 p-2.5 transition-colors group-hover:bg-oxblood-50">
          <Icon size={18} className="text-oxblood-700" />
        </div>
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          {count} {count === 1 ? "book" : "books"}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="font-display text-2xl leading-tight tracking-tight text-ink-900">
          {room.label}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
          {room.desc}
        </p>
      </div>

      {/* Decorative bottom hairline that highlights on hover */}
      <div className="absolute inset-x-6 bottom-0 h-px bg-oxblood-600/0 transition-all group-hover:bg-oxblood-600/40" />
    </Link>
  );
}
