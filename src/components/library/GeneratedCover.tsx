import type { Room } from "@/lib/taxonomy";

/**
 * Per-room cover palette. Mirrors the tints RoomCard uses for the rooms grid
 * so a generated cover reads as belonging to its room rather than as a
 * generic grey box. Values are literal hex (not Tailwind classes) because
 * they're consumed as SVG paint attributes.
 */
const COVER_THEME: Record<
  Room,
  { ground: string; rule: string; title: string; meta: string; roman: string }
> = {
  hall_of_awakening: { ground: "#FAF0EF", rule: "#A0463F", title: "#3F1612", meta: "#7B2D26", roman: "I" },
  foundation_room:   { ground: "#F8F2E2", rule: "#9C7E3D", title: "#2A1F18", meta: "#5C4A3A", roman: "II" },
  workshop:          { ground: "#F1E8CE", rule: "#5C4A3A", title: "#1A1410", meta: "#5C4A3A", roman: "III" },
  counting_room:     { ground: "#F0EBD8", rule: "#B89549", title: "#2A1F18", meta: "#9C7E3D", roman: "IV" },
  chapel:            { ground: "#EEF3EF", rule: "#3C6E50", title: "#0D1B15", meta: "#1F3D2F", roman: "V" },
  drawing_room:      { ground: "#FAF0EF", rule: "#A0463F", title: "#3F1612", meta: "#7B2D26", roman: "VI" },
  war_room:          { ground: "#EDE9E3", rule: "#2A1F18", title: "#1A1410", meta: "#3D2E22", roman: "VII" },
  observatory:       { ground: "#E7EDE9", rule: "#1F3D2F", title: "#0D1B15", meta: "#1F3D2F", roman: "VIII" },
  garden:            { ground: "#EEF3EF", rule: "#3C6E50", title: "#0D1B15", meta: "#1F3D2F", roman: "IX" },
  hall_of_elders:    { ground: "#F0EBD8", rule: "#B89549", title: "#2A1F18", meta: "#9C7E3D", roman: "X" },
  childrens_wing:    { ground: "#F8F2E2", rule: "#9C7E3D", title: "#2A1F18", meta: "#5C4A3A", roman: "XI" },
};

const NEUTRAL = {
  ground: "#F1E8CE",
  rule: "#7A6650",
  title: "#1A1410",
  meta: "#5C4A3A",
  roman: "",
};

/**
 * Greedy word wrap to a character budget per line. SVG has no automatic text
 * wrapping, so lines are computed here and emitted as <tspan>s. A word longer
 * than the budget (rare, but e.g. a long compound title) is hard-split so it
 * can never overflow the frame.
 */
function wrapRaw(text: string, budget: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (word.length > budget) {
      if (line) {
        lines.push(line);
        line = "";
      }
      let rest = word;
      while (rest.length > budget) {
        lines.push(rest.slice(0, budget - 1) + "-");
        rest = rest.slice(budget - 1);
      }
      line = rest;
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= budget) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Trim to maxLines, marking the cut with an ellipsis. */
function clampLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s,;:.-]+$/, "") + "…";
  return kept;
}

/**
 * Wrap, then tighten. Greedy wrapping packs early lines full and leaves the
 * last one nearly empty — "Following God's / Plan for Your / Life" orphans a
 * single short word. Narrowing the budget as far as it will go without adding
 * a line evens the rag out, which is what a typesetter would do.
 *
 * Two things keep the tightening honest. It compares UNCLAMPED line counts,
 * because a clamped count pins at maxLines and stops reporting that the text
 * got worse. And it never narrows below the longest word, which would start
 * hyphen-splitting names — that turned "Michael Hyatt · Megan Hyatt Miller"
 * into "MICHA- / EL…".
 */
function wrapBalanced(text: string, budget: number, maxLines: number): string[] {
  const base = wrapRaw(text, budget);
  if (base.length < 2) return clampLines(base, maxLines);

  const longestWord = text
    .split(/\s+/)
    .reduce((n, w) => Math.max(n, w.length), 0);
  const floor = Math.max(longestWord, 4);

  let best = base;
  for (let b = budget - 1; b >= floor; b--) {
    const candidate = wrapRaw(text, b);
    if (candidate.length !== base.length) break;
    best = candidate;
  }
  return clampLines(best, maxLines);
}

interface GeneratedCoverProps {
  title: string;
  authors?: string[];
  room?: Room;
}

/**
 * A typographic cover, drawn rather than fetched.
 *
 * Five of the catalogue's books have no cover art anywhere — not on
 * OpenLibrary, not on Google Books (they're small-press titles those APIs
 * don't index) — and two have no ISBN at all to look one up with. A generic
 * icon made those books look broken. This draws a real cover instead: room
 * tint, ruled frame, title set in the display serif, author in tracked mono.
 *
 * It's also the loading state for books that DO have art, so a card is never
 * blank while a remote image is still in flight.
 *
 * Rendered as SVG with a 200x300 viewBox (the 2:3 the cards already use) so
 * the type scales crisply from a 90px shelf thumbnail to a 320px hero.
 */
export function GeneratedCover({ title, authors, room }: GeneratedCoverProps) {
  const theme = (room && COVER_THEME[room]) || NEUTRAL;

  // Longer titles get more, smaller lines; short ones get fewer, larger.
  const long = title.length > 28;
  const budget = long ? 16 : 13;
  const fontSize = long ? 17 : 21;
  const lineHeight = long ? 21 : 26;
  const lines = wrapBalanced(title, budget, 4);

  // Centre the title block a little above centre, leaving room for the rule,
  // the byline, and the tail ornament beneath it.
  const blockHeight = lines.length * lineHeight;
  const titleTop = 148 - blockHeight / 2;

  const byline = authors?.length ? authors.join(" · ") : null;
  const bylineLines = byline ? wrapBalanced(byline.toUpperCase(), 26, 2) : [];
  const ruleY = titleTop + blockHeight + 16;

  /**
   * SVG def ids are document-global, so two covers on the same page would
   * otherwise share (and fight over) one gradient. Derive a stable suffix from
   * the title rather than a random value, which would differ between the
   * server and client renders and trip hydration.
   */
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

  const gradId = `mlg-${slug}`;
  const vignetteId = `mlv-${slug}`;

  return (
    <svg
      viewBox="0 0 200 300"
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      className="h-full w-full"
    >
      <defs>
        {/* Boards catch light unevenly; a slight diagonal lift stops the
         * ground reading as flat digital fill. */}
        <linearGradient id={gradId} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor={theme.rule} stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id={vignetteId} cx="0.5" cy="0.42" r="0.78">
          <stop offset="60%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.09" />
        </radialGradient>
      </defs>

      <rect width="200" height="300" fill={theme.ground} />
      <rect width="200" height="300" fill={`url(#${gradId})`} />

      {/* Spine. The single strongest cue that this is a book and not a card —
       * a cloth band down the binding edge, with the fold caught as a
       * highlight beside it. */}
      <rect width="9" height="300" fill={theme.rule} fillOpacity="0.55" />
      <rect x="9" width="1.5" height="300" fill="#FFFFFF" fillOpacity="0.35" />

      {/* Ruled frame — the double rule reads as a printed board cover. Inset
       * from the left to clear the spine. */}
      <rect
        x="20"
        y="12"
        width="168"
        height="276"
        fill="none"
        stroke={theme.rule}
        strokeOpacity="0.42"
        strokeWidth="1"
      />
      <rect
        x="24"
        y="16"
        width="160"
        height="268"
        fill="none"
        stroke={theme.rule}
        strokeOpacity="0.16"
        strokeWidth="0.75"
      />

      {/* Head ornament: rule — lozenge — rule, echoing the numeral beneath. */}
      <g stroke={theme.rule} strokeOpacity="0.45" strokeWidth="0.9">
        <line x1="42" x2="90" y1="42" y2="42" />
        <line x1="118" x2="166" y1="42" y2="42" />
      </g>
      <path
        d="M104 37.5 L108 42 L104 46.5 L100 42 Z"
        fill={theme.rule}
        fillOpacity="0.5"
      />

      {/* Room numeral, echoing the rooms grid. */}
      {theme.roman && (
        <text
          x="104"
          y="64"
          textAnchor="middle"
          fill={theme.rule}
          fillOpacity="0.55"
          fontFamily="var(--font-plex-mono), ui-monospace, monospace"
          fontSize="9"
          letterSpacing="2.5"
        >
          {theme.roman}
        </text>
      )}

      <text
        textAnchor="middle"
        fill={theme.title}
        fontFamily="var(--font-fraunces), Georgia, serif"
        fontSize={fontSize}
        letterSpacing="-0.3"
      >
        {lines.map((line, i) => (
          <tspan key={i} x="104" y={titleTop + i * lineHeight}>
            {line}
          </tspan>
        ))}
      </text>

      <line
        x1="80"
        x2="128"
        y1={ruleY}
        y2={ruleY}
        stroke={theme.rule}
        strokeOpacity="0.55"
        strokeWidth="1"
      />

      {bylineLines.length > 0 && (
        <text
          textAnchor="middle"
          fill={theme.meta}
          fontFamily="var(--font-plex-mono), ui-monospace, monospace"
          fontSize="8"
          letterSpacing="1.4"
        >
          {bylineLines.map((line, i) => (
            <tspan key={i} x="104" y={ruleY + 20 + i * 12}>
              {line}
            </tspan>
          ))}
        </text>
      )}

      {/* Imprint, flanked by tail rules. Without something here the lower
       * third reads as an empty panel and the whole cover looks top-heavy; a
       * printed board would carry the publisher's name in this position. */}
      <g stroke={theme.rule} strokeOpacity="0.35" strokeWidth="0.8">
        <line x1="42" x2="72" y1="266" y2="266" />
        <line x1="136" x2="166" y1="266" y2="266" />
      </g>
      <text
        x="104"
        y="269"
        textAnchor="middle"
        fill={theme.meta}
        fillOpacity="0.6"
        fontFamily="var(--font-plex-mono), ui-monospace, monospace"
        fontSize="6"
        letterSpacing="2.2"
      >
        MY LIBRARY
      </text>

      {/* Vignette last so it sits over the type, the way light falls on a
       * real board rather than under the printing. */}
      <rect
        width="200"
        height="300"
        fill={`url(#${vignetteId})`}
        pointerEvents="none"
      />
    </svg>
  );
}
