import { noteTypeMeta, type ChapterGroup } from "@/lib/notes";
import type { NotebookCompletion } from "@/lib/completion";

/**
 * Serialise a notebook to portable Markdown — opens cleanly in Obsidian,
 * Notion, GitHub, or any plain-text editor. Built entirely client-side from
 * the already-grouped notes; no server round-trip.
 */
export function notebookToMarkdown(
  book: { title: string; authors?: string[] },
  groups: ChapterGroup[],
  completion: NotebookCompletion | null,
): string {
  const out: string[] = [];
  out.push(`# ${book.title} — Notebook`);
  if (book.authors && book.authors.length > 0) {
    out.push(`*by ${book.authors.join(", ")}*`);
  }
  if (completion) {
    out.push(
      `\n**Progress:** ${completion.overallPercent}% · ` +
        `${completion.completedChapters}/${completion.totalChapters} chapters complete · ` +
        `${completion.readChapters} read · ${completion.annotatedChapters} annotated`,
    );
  }
  out.push(`\n_Exported ${new Date().toLocaleDateString()}_`);

  for (const g of groups) {
    out.push(`\n\n## ${g.title}`);
    for (const n of g.notes) {
      const meta = noteTypeMeta(n.type);
      const bits: string[] = [meta.label];
      if (n.anchor.page != null) bits.push(`p.${n.anchor.page}`);
      out.push(`\n### ${bits.join(" · ")}`);
      if (n.type === "exercise") {
        out.push(`- [${n.done === true ? "x" : " "}] ${meta.label.toLowerCase()}`);
      }
      if (n.quote) {
        // Quote each line so multi-line passages stay inside the blockquote.
        out.push(
          n.quote
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n"),
        );
      }
      if (n.body) out.push(`\n${n.body}`);
    }
  }

  return out.join("\n");
}

/** Trigger a client-side file download for a text blob. */
export function downloadText(
  filename: string,
  text: string,
  mime = "text/markdown",
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Filesystem-safe filename stem from a book title. */
export function safeFilename(title: string): string {
  return (
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "notebook"
  );
}
