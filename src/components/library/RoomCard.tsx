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

/**
 * Per-room visual treatment: each room gets its own accent tint so the grid
 * has visible variation rather than 11 identical cards.
 *
 *   tint      = subtle background wash
 *   accent    = the rim + icon + footer hairline highlight
 *   roman     = the decorative oversized roman numeral
 */
const ROOM_THEME: Record<
  Room,
  { tint: string; accent: string; roman: string }
> = {
  hall_of_awakening:  { tint: "bg-oxblood-50/40",  accent: "text-oxblood-700",  roman: "I" },
  foundation_room:    { tint: "bg-parchment-100",   accent: "text-ink-700",      roman: "II" },
  workshop:           { tint: "bg-parchment-100",   accent: "text-ink-700",      roman: "III" },
  counting_room:      { tint: "bg-[#F0EBD8]",       accent: "text-gold-600",     roman: "IV" },
  chapel:             { tint: "bg-forest-50",       accent: "text-forest-600",   roman: "V" },
  drawing_room:       { tint: "bg-oxblood-50/30",   accent: "text-oxblood-700",  roman: "VI" },
  war_room:           { tint: "bg-[#1A1410]/[0.04]",accent: "text-ink-800",      roman: "VII" },
  observatory:        { tint: "bg-[#1F3D2F]/10",    accent: "text-forest-600",   roman: "VIII" },
  garden:             { tint: "bg-forest-50",       accent: "text-forest-600",   roman: "IX" },
  hall_of_elders:     { tint: "bg-[#F0EBD8]",       accent: "text-gold-600",     roman: "X" },
  childrens_wing:     { tint: "bg-parchment-100",   accent: "text-ink-700",      roman: "XI" },
};

interface RoomCardProps {
  roomKey: Room;
  count: number;
  size?: "1x1" | "2x1" | "1x2";
}

export function RoomCard({ roomKey, count, size = "1x1" }: RoomCardProps) {
  const room = ROOMS[roomKey];
  const Icon = ICONS[room.icon] ?? Compass;
  const theme = ROOM_THEME[roomKey];

  const sizeClass =
    size === "2x1"
      ? "md:col-span-2"
      : size === "1x2"
        ? "md:row-span-2"
        : "";

  return (
    <Link
      href={`/library/room/${roomKey}`}
      className={
        `group relative flex flex-col justify-between overflow-hidden rounded-sm border ml-hairline ${theme.tint} p-6 shadow-paper transition-all hover:-translate-y-0.5 hover:shadow-paper-lg ` +
        sizeClass
      }
    >
      {/* Decorative oversized Roman numeral */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-2 -top-6 select-none font-display text-[8rem] leading-none ${theme.accent} opacity-[0.07] md:text-[9rem]`}
      >
        {theme.roman}
      </span>

      <div className="relative flex items-start justify-between">
        <div className="rounded-full border ml-hairline bg-parchment-50 p-2.5 shadow-paper transition-colors group-hover:bg-parchment-100">
          <Icon size={18} className={theme.accent} />
        </div>
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
          {count} {count === 1 ? "book" : "books"}
        </div>
      </div>

      <div className="relative mt-8">
        <h3 className="font-display text-2xl leading-tight tracking-tight text-ink-900">
          {room.label}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
          {room.desc}
        </p>
      </div>

      {/* Decorative bottom hairline that lights up on hover (uniform accent
          rather than per-room — Tailwind JIT can't resolve dynamic class names). */}
      <div className="absolute inset-x-6 bottom-0 h-px bg-transparent transition-colors group-hover:bg-oxblood-600/40" />
    </Link>
  );
}
