"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactReader, type IReactReaderProps } from "react-reader";
import type { Rendition, Book as EpubBook } from "epubjs";
import {
  ChevronLeft,
  ChevronRight,
  PenLine,
  Trash2,
  Type,
  X as XIcon,
} from "lucide-react";
import { makeDebouncedSaver } from "@/lib/progress";
import {
  chapterForPageIndex,
  createNote,
  deleteNote,
  emptyAnchor,
  HIGHLIGHT_COLORS,
  watchBookNotes,
} from "@/lib/notes";

import type { EpubChapterMapping, Note } from "@/lib/types";

interface EPUBReaderProps {
  url: string;
  userId: string;
  bookId: string;
  /** Initial EPUB CFI to restore. */
  initialCfi?: string;
  /** Map of EPUB chapters to PDF source pages, from the convert pipeline. */
  chapterMap?: EpubChapterMapping[];
  /** Page set externally (PDF/Voice readers). When this changes AND this
   * reader isn't currently focused, navigate to the matching chapter. */
  externalPage?: number | null;
  /** Page currently being narrated by voice (fallback for older voice
   * generations that don't have paragraph data). When set, ALL paragraphs
   * on this page get a soft highlight. */
  currentReadingPage?: number | null;
  /** Single-paragraph target currently being narrated. When set, ONLY the
   * matching paragraph gets the highlight — much cleaner UX than the
   * whole-page fallback. Requires the voice segment to have pages_paragraphs
   * (generated after Phase 9e). */
  currentReadingParagraph?: {
    page: number;
    paragraphIndex: number;
  } | null;
  onPercentChange?: (pct: number) => void;
}

export function EPUBReader({
  url,
  userId,
  bookId,
  initialCfi,
  chapterMap,
  externalPage,
  currentReadingPage,
  currentReadingParagraph,
  onPercentChange,
}: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(initialCfi ?? 0);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const locationsReady = useRef(false);
  const [pct, setPct] = useState<number | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    cfi: string;
    text: string;
    page: number | null;
    paragraphIndex: number | null;
  } | null>(null);
  const [composer, setComposer] = useState<{
    cfi: string;
    text: string;
    page: number | null;
    paragraphIndex: number | null;
  } | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{
    cfi: string;
    noteId: string;
  } | null>(null);
  // Live notes for this book → drive the saved-highlight annotations.
  const [notes, setNotes] = useState<Note[]>([]);
  const notesRef = useRef<Note[]>([]);
  // cfiRange → applied colour, so we add/remove epub.js annotations diff-style.
  const appliedRef = useRef<Map<string, string>>(new Map());
  // Set true only when a chapter is actually rendered but carries no page
  // anchors — i.e. the stored EPUB predates the anchor-emitting converter and
  // page-sync/highlighting can't work until it's re-converted.
  const [needsReconvert, setNeedsReconvert] = useState(false);
  // Default font: 95% on desktop, 85% on mobile (narrow viewport = less
  // horizontal room, smaller font = more lines fit on screen)
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return 85;
    return 95;
  });
  const [chapterTitle, setChapterTitle] = useState<string>("");
  // Flips true on the first "rendered" event. Used as a highlight-effect
  // dependency so that if audio is already mid-paragraph when the EPUB mounts
  // (e.g. user switches to the EPUB tab while listening), the highlight runs
  // as soon as the iframe content exists — not only on the next paragraph.
  const [renditionReady, setRenditionReady] = useState(0);

  const saver = useMemo(
    () => makeDebouncedSaver(userId, bookId, 1500),
    [userId, bookId],
  );

  // Re-apply theme whenever the font size changes
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    try {
      r.themes.fontSize(`${fontSize}%`);
    } catch {}
  }, [fontSize]);

  // Save on every relocation event + compute percent once locations are built
  function handleLocationChanged(cfi: string) {
    setLocation(cfi);

    let percent: number | undefined = undefined;
    const book = epubBookRef.current;
    if (book && locationsReady.current) {
      try {
        const p = book.locations.percentageFromCfi(cfi);
        if (typeof p === "number" && !Number.isNaN(p)) {
          percent = Math.round(p * 100);
          setPct(percent);
          onPercentChange?.(percent);
        }
      } catch {
        // locations not yet usable — ignore
      }
    }

    saver.save({ current_cfi: cfi, current_percent: percent });
  }

  // Every 10 seconds, push latest position (spec §16)
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof location === "string") {
        const book = epubBookRef.current;
        let percent: number | undefined = undefined;
        if (book && locationsReady.current) {
          try {
            const p = book.locations.percentageFromCfi(location);
            if (typeof p === "number" && !Number.isNaN(p)) {
              percent = Math.round(p * 100);
            }
          } catch {}
        }
        saver.save({ current_cfi: location, current_percent: percent });
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [location, saver]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      void saver.flush();
    };
  }, [saver]);

  // ----- Highlights (Phase D: unified book_notes model) -------------------
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  useEffect(() => {
    return watchBookNotes(userId, bookId, setNotes);
  }, [userId, bookId]);

  // Tapping a rendered highlight asks to remove it (the cb is wired into each
  // epub.js annotation). We resolve the note id from the latest notes via ref.
  const requestRemoveByCfi = useCallback((cfi: string) => {
    const note = notesRef.current.find((n) => n.anchor.cfi_range === cfi);
    if (note) setPendingRemoval({ cfi, noteId: note.id });
  }, []);

  // Reconcile epub.js annotations with the saved EPUB highlights, diff-style:
  // add new ones, remove deleted/recoloured ones. epub.js keeps annotations
  // across section renders and draws them when their section is shown, so a
  // single add per cfiRange is enough; renditionReady re-runs this after the
  // first render so notes that loaded before the rendition still get drawn.
  useEffect(() => {
    const r = renditionRef.current;
    if (!r) return;
    const want = new Map<string, string>();
    for (const n of notes) {
      if (n.anchor.medium === "epub" && n.anchor.cfi_range) {
        want.set(n.anchor.cfi_range, n.color ?? "#E8C766");
      }
    }
    // Remove stale or recoloured
    for (const [cfi, color] of Array.from(appliedRef.current)) {
      if (!want.has(cfi) || want.get(cfi) !== color) {
        try {
          r.annotations.remove(cfi, "highlight");
        } catch {}
        appliedRef.current.delete(cfi);
      }
    }
    // Add new
    for (const [cfi, color] of want) {
      if (appliedRef.current.has(cfi)) continue;
      try {
        r.annotations.highlight(
          cfi,
          {},
          () => requestRemoveByCfi(cfi),
          "epub-note",
          { fill: color, "fill-opacity": "0.30", "mix-blend-mode": "multiply" },
        );
        appliedRef.current.set(cfi, color);
      } catch {
        // Section not ready yet — retried on the next render via renditionReady.
      }
    }
  }, [notes, renditionReady, requestRemoveByCfi]);

  // External-page → chapter navigation. When the user is on another tab (PDF
  // or Voice) and advances pages there, externalPage changes. If chapterMap
  // tells us which chapter contains that PDF page, navigate there — but ONLY
  // when the resolved chapter actually changes, not on every page turn.
  //
  // Why the dedupe matters: voice playback advances externalPage page-by-page
  // within a chapter. If we re-displayed the chapter href on every page, the
  // reader would snap back to the chapter's first page each time, then
  // pageFollow would flip forward to the narrated paragraph — a visible
  // back-and-forth jitter. Tracking the last navigated chapter href means we
  // only load a new section when the reader genuinely crosses into it; the
  // within-chapter page flipping is left entirely to pageFollow.
  //
  // Precise sync (fix for "jumps to chapter beginning"): we navigate to the
  // per-paragraph anchor the converter emits (id="pg{page}-p{idx}") rather
  // than the chapter href, so we land on the exact page being read. Deduped by
  // source page so we don't re-navigate on every event.
  const lastSyncedPageRef = useRef<number | null>(null);
  const lastNarrationNavRef = useRef<number | null>(null);
  // Track current highlight target in refs so the "rendered" event handler
  // (set up once at mount) can read the latest values without re-binding.
  const currentHighlightPageRef = useRef<number | null>(null);
  const currentHighlightParagraphRef = useRef<{
    page: number;
    paragraphIndex: number;
  } | null>(null);
  useEffect(() => {
    currentHighlightPageRef.current = currentReadingPage ?? null;
  }, [currentReadingPage]);
  useEffect(() => {
    currentHighlightParagraphRef.current = currentReadingParagraph ?? null;
  }, [currentReadingParagraph]);
  // Resolve the chapter href that contains a given source page.
  const chapterHrefForPage = useCallback(
    (page: number): string | null => {
      if (!chapterMap || chapterMap.length === 0) return null;
      let target: EpubChapterMapping | null = null;
      for (const c of chapterMap) {
        if (c.source_page_start <= page) target = c;
        else break;
      }
      return target ? target.href : null;
    },
    [chapterMap],
  );

  // Navigate to the EXACT source page (and paragraph) via the converter's
  // per-paragraph anchors (id="pg{page}-p{idx}"). Displaying the chapter href
  // alone lands on the chapter's first page — the cause of "jumps back to the
  // chapter beginning". Falls back to the chapter href for EPUBs built before
  // anchors existed (those need a Re-convert for precise sync).
  const navigateToSourcePage = useCallback(
    (page: number, paragraphIndex = 0) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const href = chapterHrefForPage(page);
      const base = href ? href.split("#")[0] : "";
      const anchorId = `pg${page}-p${paragraphIndex}`;
      const target = base ? `${base}#${anchorId}` : anchorId;
      Promise.resolve(rendition.display(target)).catch(() => {
        if (base) Promise.resolve(rendition.display(base)).catch(() => {});
      });
    },
    [chapterHrefForPage],
  );

  // Cross-tab sync: when the member advances pages on the PDF/Voice tab,
  // externalPage changes. Jump to that exact page (not the chapter start).
  // Deduped by page; during pure listening externalPage is static so this
  // stays dormant and never fights paragraph-follow.
  useEffect(() => {
    if (externalPage == null) return;
    if (!renditionRef.current) return;
    if (lastSyncedPageRef.current === externalPage) return;
    lastSyncedPageRef.current = externalPage;
    navigateToSourcePage(externalPage, 0);
  }, [externalPage, navigateToSourcePage]);

  // Follow the audio in PAGINATED mode by flipping to the page that contains
  // the just-highlighted paragraph — the EPUB analogue of the PDF advancing
  // pages.
  //
  // The reliable mechanism is to navigate to the paragraph's stable anchor
  // (id="pg{page}-p{idx}") — the same path TOC deep-links use. epub.js snaps to
  // whole pages, so navigating to an anchor already on the visible page is a
  // no-op (no jitter), and navigating to one on another page flips there. We
  // dedupe by anchor so we don't re-issue display() for the same paragraph.
  //
  // This deliberately does NOT depend on getBoundingClientRect geometry for the
  // common (anchored) path — that geometry was brittle across epub.js layout
  // modes and was a prior source of "doesn't turn". Node-CFI + scroll remain as
  // fallbacks only for EPUBs built before the id anchors existed.
  const lastFollowRef = useRef<string | null>(null);
  function pageFollow(
    el: Element,
    contents: { window: Window; cfiFromNode?: (n: Node) => string },
  ) {
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      const page = parseInt(el.getAttribute("data-source-page") ?? "", 10);
      const idx = parseInt(
        el.getAttribute("data-page-paragraph-index") ?? "0",
        10,
      );
      if (el.id && !Number.isNaN(page) && chapterMap && chapterMap.length > 0) {
        if (lastFollowRef.current === el.id) return; // already followed this one
        lastFollowRef.current = el.id;
        navigateToSourcePage(page, Number.isNaN(idx) ? 0 : idx);
        return;
      }
      // Fallbacks (no id anchors): only move when the element is off the current
      // page, using geometry + a node CFI, else a plain scroll.
      const rect = (el as HTMLElement).getBoundingClientRect();
      const w = contents.window.innerWidth || 0;
      if (rect.width === 0 && rect.height === 0) return;
      if (rect.right > 2 && rect.left < w - 2) return;
      const cfi = contents.cfiFromNode?.(el);
      if (cfi) {
        void rendition.display(cfi);
        return;
      }
      (el as HTMLElement).scrollIntoView?.({ block: "start" });
    } catch {
      /* iframe not ready / navigation failure — ignore, highlight still set */
    }
  }
  useEffect(() => {
    if (!renditionRef.current) return;
    if (currentReadingPage == null && !currentReadingParagraph) return;
    try {
      const contents = renditionRef.current.getContents() as unknown as Array<{
        document: Document;
        window: Window;
        cfiFromNode?: (n: Node) => string;
      }>;
      let matched = false;
      let anchorCount = 0;
      for (const c of contents) {
        if (!c || !c.document) continue;
        anchorCount += c.document.querySelectorAll("[data-source-page]").length;
        // Always clear previous highlights first
        c.document
          .querySelectorAll(".voice-highlight")
          .forEach((el) => el.classList.remove("voice-highlight"));
        // Apply new — paragraph-level if we have it
        if (currentReadingParagraph) {
          const selector = `[data-source-page="${currentReadingParagraph.page}"][data-page-paragraph-index="${currentReadingParagraph.paragraphIndex}"]`;
          const matches = c.document.querySelectorAll(selector);
          if (matches.length > 0) {
            matches.forEach((el) => el.classList.add("voice-highlight"));
            pageFollow(matches[0], c);
            matched = true;
            continue;
          }
        }
        if (currentReadingPage != null) {
          const pageMatches = c.document.querySelectorAll(
            `[data-source-page="${currentReadingPage}"]`,
          );
          if (pageMatches.length > 0) {
            pageMatches.forEach((el) => el.classList.add("voice-highlight"));
            pageFollow(pageMatches[0], c);
            matched = true;
          }
        }
      }
      // A match means we're on the right chapter — clear the nav dedupe so a
      // later return to a far page can navigate again.
      if (matched) {
        lastNarrationNavRef.current = null;
        if (needsReconvert) setNeedsReconvert(false);
      }
      // If a chapter is rendered (has a document) but carries NO page anchors,
      // this EPUB predates the converter and can't be synced — flag it so the
      // member is told to re-convert (no console-spelunking required).
      if (!matched && contents.length > 0 && anchorCount === 0 && !needsReconvert) {
        setNeedsReconvert(true);
      }
      // Diagnostic (9w): if we have a narration target but found no match,
      // report what the rendered content actually contains. anchorCount === 0
      // means this EPUB has no page anchors at all → it predates the current
      // converter and needs a Re-convert. anchorCount > 0 but no match means
      // the narrated page isn't in the currently-rendered chapter yet — so we
      // navigate to its anchor (loads the right chapter at the exact page).
      if (!matched) {
        const narratedPage =
          currentReadingParagraph?.page ?? currentReadingPage ?? null;
        if (
          narratedPage != null &&
          anchorCount > 0 &&
          lastNarrationNavRef.current !== narratedPage
        ) {
          lastNarrationNavRef.current = narratedPage;
          navigateToSourcePage(
            narratedPage,
            currentReadingParagraph?.paragraphIndex ?? 0,
          );
        }
        console.warn(
          `[epub-sync] no highlight match. narratedPage=${currentReadingPage} para=${
            currentReadingParagraph
              ? `${currentReadingParagraph.page}/${currentReadingParagraph.paragraphIndex}`
              : "none"
          } anchorsInView=${anchorCount}` +
            (anchorCount === 0
              ? " → this EPUB has no page anchors; Re-convert the book."
              : " → narrated page not in the rendered chapter yet."),
        );
      }
    } catch (err) {
      console.warn("[epub] highlight update failed", err);
    }
  }, [
    currentReadingPage,
    currentReadingParagraph,
    renditionReady,
    navigateToSourcePage,
  ]);

  const getRendition: IReactReaderProps["getRendition"] = (rendition) => {
    renditionRef.current = rendition;
    const book = rendition.book;
    epubBookRef.current = book;

    // Match the library's typography. This theme drives the IN-APP render
    // (the bundled styles.css only applies in external readers). Keep the two
    // visually aligned: justified body with a first-line indent, headings set
    // apart, no indent on the paragraph following a heading.
    rendition.themes.register("library", {
      body: {
        "font-family":
          "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
        color: "#1A1410",
        "line-height": "1.62",
        padding: "0 0.25rem !important",
        margin: "0 !important",
      },
      p: {
        "font-size": "1rem",
        margin: "0",
        "text-indent": "1.3em",
        "text-align": "justify",
        hyphens: "auto",
        "-webkit-hyphens": "auto",
      },
      // First paragraph & paragraphs right after a heading: no indent.
      "h1 + p, h2 + p, h3 + p, .chapter-title + p, p:first-of-type": {
        "text-indent": "0",
      },
      "p + p": { "margin-top": "0.15em" },
      li: { "font-size": "1rem", "text-align": "left" },
      h1: { "font-size": "1.5rem", "margin-top": "1rem", "line-height": "1.25" },
      h2: {
        "font-size": "1.28rem",
        "font-weight": "700",
        margin: "1.5em 0 0.5em 0",
        "line-height": "1.25",
      },
      h3: {
        "font-size": "1.06rem",
        "font-weight": "600",
        "font-style": "italic",
        margin: "1.25em 0 0.35em 0",
      },
      ".chapter-title": {
        "text-align": "center !important",
        "text-indent": "0 !important",
        margin: "1em 0 1.2em 0",
      },
      blockquote: {
        "border-left": "2px solid rgba(123,45,38,0.4)",
        "padding-left": "0.75rem",
        margin: "1em 0",
        "font-style": "italic",
      },
      "blockquote p": { "text-indent": "0", "text-align": "left" },
      // The .voice-highlight class is toggled via DOM manipulation each time
      // the narrated paragraph changes. scroll-margin keeps scrollIntoView
      // from jamming the highlighted line against the very top/bottom edge.
      ".voice-highlight": {
        "background-color": "rgba(201, 169, 97, 0.28) !important",
        "border-left": "3px solid #C9A961 !important",
        padding: "0.2em 0.4em !important",
        "margin-left": "-0.6em !important",
        "text-indent": "0 !important",
        "scroll-margin-top": "40vh !important",
        "scroll-margin-bottom": "40vh !important",
        transition: "background-color 0.3s ease !important",
      },
    });
    rendition.themes.select("library");
    rendition.themes.fontSize(`${fontSize}%`);

    // Capture selections inside the iframe — react-reader's epub.js exposes
    // a "selected" event with (cfiRange, contents). We surface a "Save
    // highlight" prompt in the parent UI rather than mutating the iframe.
    rendition.on("selected", (cfiRange: string, contents: { window: Window }) => {
      try {
        const sel = contents.window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (text.length < 2) return;
        // Derive the source page/paragraph from the nearest anchored element so
        // the note files under the right chapter in the notebook.
        let page: number | null = null;
        let paragraphIndex: number | null = null;
        try {
          const range = sel?.getRangeAt(0);
          const node: Node | null | undefined = range?.commonAncestorContainer;
          const elNode =
            node && node.nodeType === 1
              ? (node as Element)
              : (node?.parentElement ?? null);
          const anchored = elNode?.closest?.("[data-source-page]") ?? null;
          if (anchored) {
            const p = anchored.getAttribute("data-source-page");
            const pi = anchored.getAttribute("data-page-paragraph-index");
            page = p ? parseInt(p, 10) : null;
            paragraphIndex = pi ? parseInt(pi, 10) : null;
          }
        } catch {}
        setPendingSelection({ cfi: cfiRange, text, page, paragraphIndex });
      } catch (err) {
        console.warn("[epub] selection capture failed", err);
      }
    });

    // Track current chapter from the spine, AND re-apply voice highlight
    // since each render swaps out the iframe contents (clearing prior classes)
    rendition.on("rendered", (section: { href?: string }) => {
      // Signal the highlight effect that content is now available to query.
      setRenditionReady((n) => n + 1);
      try {
        const nav = book.navigation;
        if (nav && section.href) {
          const item = nav.get(section.href);
          if (item?.label) setChapterTitle(item.label.trim());
        }
      } catch {}
      // Re-apply highlight after a small delay to let the iframe finish loading
      const paragraphTarget = currentHighlightParagraphRef.current;
      const pageTarget = currentHighlightPageRef.current;
      if (paragraphTarget || pageTarget != null) {
        setTimeout(() => {
          try {
            const contents = rendition.getContents() as unknown as Array<{
              document: Document;
              window: Window;
              cfiFromNode?: (n: Node) => string;
            }>;
            for (const c of contents) {
              if (!c || !c.document) continue;
              c.document
                .querySelectorAll(".voice-highlight")
                .forEach((el) => el.classList.remove("voice-highlight"));
              if (paragraphTarget) {
                const sel = `[data-source-page="${paragraphTarget.page}"][data-page-paragraph-index="${paragraphTarget.paragraphIndex}"]`;
                const matches = c.document.querySelectorAll(sel);
                if (matches.length > 0) {
                  matches.forEach((el) => el.classList.add("voice-highlight"));
                  pageFollow(matches[0], c);
                  continue;
                }
              }
              if (pageTarget != null) {
                const pm = c.document.querySelectorAll(
                  `[data-source-page="${pageTarget}"]`,
                );
                pm.forEach((el) => el.classList.add("voice-highlight"));
                if (pm.length > 0) pageFollow(pm[0], c);
              }
            }
          } catch {}
        }, 120);
      }
    });

    // Generate per-character locations so we can compute percent.
    // 1024 = generate one location per ~1024 chars; reasonable balance.
    book.ready
      .then(() => book.locations.generate(1024))
      .then(() => {
        locationsReady.current = true;
        // Re-emit percent for current location
        if (typeof location === "string") {
          try {
            const p = book.locations.percentageFromCfi(location);
            if (typeof p === "number" && !Number.isNaN(p)) {
              const pp = Math.round(p * 100);
              setPct(pp);
              onPercentChange?.(pp);
            }
          } catch {}
        }
      })
      .catch(() => {
        // Locations failed — non-fatal, we just skip percent tracking
      });
  };

  const clearIframeSelection = useCallback(() => {
    try {
      const contents = renditionRef.current?.getContents();
      const arr = (Array.isArray(contents) ? contents : [contents]) as Array<{
        window: Window;
      }>;
      for (const c of arr) c?.window?.getSelection?.()?.removeAllRanges();
    } catch {}
  }, []);

  const toast = useCallback((msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(null), 1800);
  }, []);

  const saveEpubHighlight = useCallback(
    async (
      snap: {
        cfi: string;
        text: string;
        page: number | null;
        paragraphIndex: number | null;
      },
      color: string | null,
      body: string,
    ) => {
      const ch = chapterForPageIndex(chapterMap, snap.page ?? undefined);
      try {
        await createNote(userId, bookId, {
          type: "highlight",
          quote: snap.text,
          color,
          body,
          anchor: {
            ...emptyAnchor("epub"),
            chapter_index: ch.index,
            chapter_title: ch.title,
            page: snap.page,
            paragraph_index: snap.paragraphIndex,
            cfi: snap.cfi,
            cfi_range: snap.cfi,
          },
        });
        toast(body ? "Note saved" : "Highlighted");
      } catch (err) {
        console.error("[epub] saveEpubHighlight failed", err);
        toast("Couldn’t save — try again");
      }
    },
    [userId, bookId, chapterMap, toast],
  );

  /** Instant colour highlight from the current selection. */
  function highlightWith(color: string) {
    if (!pendingSelection) return;
    void saveEpubHighlight(pendingSelection, color, "");
    clearIframeSelection();
    setPendingSelection(null);
  }
  /** Open the quick note sheet for the current selection. */
  function openComposer() {
    if (!pendingSelection) return;
    setComposer(pendingSelection);
    clearIframeSelection();
    setPendingSelection(null);
  }
  async function confirmRemove() {
    if (!pendingRemoval) return;
    const { cfi, noteId } = pendingRemoval;
    setPendingRemoval(null);
    try {
      renditionRef.current?.annotations.remove(cfi, "highlight");
    } catch {}
    appliedRef.current.delete(cfi);
    try {
      await deleteNote(noteId);
      toast("Highlight removed");
    } catch {
      toast("Couldn’t remove — try again");
    }
  }

  const goPrev = useCallback(() => {
    void renditionRef.current?.prev();
  }, []);
  const goNext = useCallback(() => {
    void renditionRef.current?.next();
  }, []);

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border ml-hairline bg-parchment-50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrev}
            className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100"
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
          {chapterTitle && (
            <span className="ml-2 max-w-xs truncate font-display text-sm text-ink-700">
              {chapterTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Type size={13} className="text-ink-500" />
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.max(70, f - 10))}
            className="rounded-sm px-2 py-1 font-mono text-[0.65rem] text-ink-700 hover:bg-parchment-100"
            aria-label="Smaller font"
          >
            A−
          </button>
          <span className="font-mono text-[0.65rem] text-ink-500">
            {fontSize}%
          </span>
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.min(180, f + 10))}
            className="rounded-sm px-2 py-1 font-mono text-[0.65rem] text-ink-700 hover:bg-parchment-100"
            aria-label="Larger font"
          >
            A+
          </button>
        </div>
      </div>

      <div className="epub-container relative h-[calc(100vh-220px)] min-h-[480px] w-full overflow-hidden rounded-sm border ml-hairline bg-parchment-50 shadow-paper-lg md:h-[calc(100vh-200px)]">
      <ReactReader
        url={url}
        location={location}
        locationChanged={handleLocationChanged}
        getRendition={getRendition}
        epubInitOptions={{ openAs: "epub" }}
      />
      {pct !== null && (
        <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-ink-900/70 px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-parchment-50">
          {pct}%
        </div>
      )}

      {/* Selection action — anchored to the top of the reader since we can't
          reliably get coords from inside the EPUB iframe across origins. */}
      {pendingSelection && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
          <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-sm border ml-hairline bg-parchment-50 px-2.5 py-2 shadow-paper-lg">
            <div className="flex items-center gap-1">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => highlightWith(c.hex)}
                  title={c.label}
                  aria-label={`Highlight ${c.label}`}
                  className="h-5 w-5 rounded-full border border-ink-500/25 transition-transform hover:scale-110"
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
            <span className="mx-0.5 h-5 w-px bg-ink-500/15" />
            <button
              type="button"
              onClick={openComposer}
              className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/20 px-2 py-1 text-xs text-ink-800 hover:bg-parchment-100"
            >
              <PenLine size={12} /> Note
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingSelection(null);
                clearIframeSelection();
              }}
              className="rounded-sm p-1 text-ink-500 hover:bg-parchment-100"
              aria-label="Dismiss"
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Remove-highlight confirmation (tapping a saved highlight) */}
      {pendingRemoval && (
        <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-sm border ml-hairline bg-parchment-50 px-3 py-2 text-sm shadow-paper-lg">
          <span className="text-ink-700">Remove this highlight?</span>
          <button
            type="button"
            onClick={() => void confirmRemove()}
            className="inline-flex items-center gap-1 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-2 py-1 text-xs text-oxblood-700 hover:bg-oxblood-50/70"
          >
            <Trash2 size={12} /> Remove
          </button>
          <button
            type="button"
            onClick={() => setPendingRemoval(null)}
            className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500 hover:text-ink-900"
          >
            Cancel
          </button>
        </div>
      )}

      {needsReconvert && (
        <div className="absolute inset-x-2 top-3 z-30 mx-auto max-w-md rounded-sm border border-gold-600/50 bg-parchment-100 px-3 py-2 text-center text-xs leading-relaxed text-ink-800 shadow-paper-lg">
          This book was converted by an older pipeline, so page-sync and
          highlights can&rsquo;t line up. Re-run{" "}
          <span className="font-semibold">Convert</span> (then{" "}
          <span className="font-semibold">Generate voice</span>) in admin.
          <button
            type="button"
            onClick={() => setNeedsReconvert(false)}
            className="ml-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-500 hover:text-ink-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {savedToast && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-sm border border-forest-600/40 bg-forest-50 px-3 py-1.5 text-sm text-forest-600 shadow-paper-lg">
          ✓ {savedToast}
        </div>
      )}
      </div>

      {composer && (
        <EpubNoteSheet
          snapshot={composer}
          onSave={(color, body) => {
            void saveEpubHighlight(composer, color, body);
            setComposer(null);
          }}
          onCancel={() => setComposer(null)}
        />
      )}
    </div>
  );
}

function EpubNoteSheet({
  snapshot,
  onSave,
  onCancel,
}: {
  snapshot: {
    cfi: string;
    text: string;
    page: number | null;
    paragraphIndex: number | null;
  };
  onSave: (color: string, body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [color, setColor] = useState<string>(HIGHLIGHT_COLORS[0].hex);
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/30"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-t-lg border ml-hairline bg-parchment-50 p-4 shadow-paper-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 max-h-24 overflow-y-auto font-display text-sm italic text-ink-700">
          “{snapshot.text}”
        </p>
        <div className="mb-3 flex items-center gap-1.5">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setColor(c.hex)}
              title={c.label}
              aria-label={c.label}
              className={`h-6 w-6 rounded-full ${
                color === c.hex
                  ? "ring-2 ring-ink-700 ring-offset-1"
                  : "border border-ink-500/25"
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add a thought…"
          autoFocus
          className="w-full resize-none rounded-sm border ml-hairline bg-parchment-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-gold-500"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500 hover:text-ink-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(color, body.trim())}
            className="rounded-sm border border-oxblood-700 bg-oxblood-600 px-3 py-1.5 text-sm font-medium text-parchment-50 hover:bg-oxblood-700"
          >
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
