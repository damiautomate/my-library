import type { ReactNode } from "react";

/**
 * Minimal, dependency-free markdown renderer for note bodies.
 *
 * Deliberately small and SAFE: it builds React nodes directly (never
 * dangerouslySetInnerHTML), so there's no XSS surface. Supports the subset that
 * actually matters for reading notes:
 *   - paragraphs (blank-line separated), soft line breaks
 *   - "- " / "* " bullet lists, "1." ordered lists
 *   - "> " blockquotes
 *   - "#"/"##"/"###" headings (sized down — notes are small)
 *   - inline **bold**, *italic* / _italic_, `code`
 *
 * Not a spec-complete parser; unknown syntax falls through as plain text.
 */

const INLINE = [
  {
    re: /\*\*(.+?)\*\*/,
    wrap: (s: string, key: string) => <strong key={key}>{renderInline(s, key)}</strong>,
  },
  {
    re: /`([^`]+)`/,
    wrap: (s: string, key: string) => (
      <code
        key={key}
        className="rounded bg-parchment-200/70 px-1 py-0.5 font-mono text-[0.85em]"
      >
        {s}
      </code>
    ),
  },
  {
    re: /\*([^*\n]+)\*/,
    wrap: (s: string, key: string) => <em key={key}>{renderInline(s, key)}</em>,
  },
];

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    let best: { idx: number; len: number; inner: string; wrap: (s: string, key: string) => ReactNode } | null = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) {
        best = { idx: m.index, len: m[0].length, inner: m[1], wrap: p.wrap };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.idx > 0) nodes.push(rest.slice(0, best.idx));
    nodes.push(best.wrap(best.inner, `${keyPrefix}-i${k}`));
    rest = rest.slice(best.idx + best.len);
    k++;
  }
  return nodes;
}

const SPECIAL = /^(#{1,3}\s|>\s?|[-*]\s+|\d+\.\s+)/;

function headingClass(level: number): string {
  if (level === 1) return "mt-1 font-display text-base font-semibold text-ink-900";
  if (level === 2) return "mt-1 font-display text-[0.95rem] font-semibold text-ink-900";
  return "mt-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink-600";
}

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push(
        <p key={`b${key++}`} className={headingClass(h[1].length)}>
          {renderInline(h[2], `b${key}`)}
        </p>,
      );
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote
          key={`b${key++}`}
          className="my-1 border-l-2 border-ink-500/30 pl-3 italic text-ink-700"
        >
          {renderInline(buf.join(" "), `b${key}`)}
        </blockquote>,
      );
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`b${key++}`} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `b${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push(
        <ol key={`b${key++}`} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `b${key}-${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    // Paragraph: gather consecutive plain lines, soft-breaking between them.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !SPECIAL.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(
      <p key={`b${key++}`} className="my-1 first:mt-0">
        {buf.flatMap((b, bi) =>
          bi === 0
            ? renderInline(b, `b${key}-${bi}`)
            : [<br key={`br${bi}`} />, ...renderInline(b, `b${key}-${bi}`)],
        )}
      </p>,
    );
  }
  return out;
}

export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <div className={className}>{parseBlocks(text)}</div>;
}
