# My Library — App 1 (Phases 1 + 2 + 3)

> A curated, invite-only digital library. Books classified across 26 life
> domains, 7 stages, 11 rooms. The storage and organisation foundation for
> a future Library Keeper (App 2).

**Phase 3 status: ✅ built** — ISBN auto-fill, library-wide search, the My Shelf
page, per-book notes, and basic highlight capture from both readers.

## What works now

**From Phase 1**
- Next.js 14 + TypeScript + Tailwind, design system, taxonomy
- Firebase Auth with invite allowlist; Firestore + security rules
- Admin book CRUD; rooms grid; browse with facet filters; book detail

**From Phase 2**
- Signed Cloudinary uploads (PDF, EPUB, audio, cover) with progress bars
- In-app PDF, EPUB, and audio readers with debounced progress saves
- Auto-status transitions; "mark as finished" rating + closing-note modal
- Download buttons; humanized auth errors

**New in Phase 3**
- **ISBN auto-fill** — admin paste an ISBN, click *Auto-fill*, and the form is populated from Google Books (with Open Library fallback)
- **Library search** at `/library/search?q=…` — token-based ranked search across title, subtitle, authors, description
- **Header search shortcut** — always-on magnifying glass in the nav
- **My Shelf** at `/library/shelf` — status tabs (currently reading, want to read, finished, paused, abandoned), stats row (incl. "Finished in {year}"), live-updating book grids per tab
- **Reader's Notes** — private free-form notes per book, debounced auto-save
- **Highlight capture** in both readers:
  - PDF: select text → floating "Save highlight" pill → stored with page number
  - EPUB: select text → top-of-reader prompt → stored with CFI
- **Highlights gallery** on the book detail page with date stamps and remove-on-hover

## What's still ahead

- **Phase 4** — Reader's Passport stats page, atmospheric polish for the rooms grid, mobile pass, role management

---

## Online-only deploy (same workflow as Phase 2)

### 1. Pull Phase 3 into your Codespace

1. Open your `my-library` repo on GitHub → green **Code** → **Codespaces** → **Create codespace on main** (or reopen an existing one).
2. Drag the `my-library-phase3.zip` into the file explorer.
3. Terminal:
   ```bash
   unzip -o my-library-phase3.zip -d /tmp/p3
   cp -r /tmp/p3/my-library/. .
   rm my-library-phase3.zip
   git add -A
   git commit -m "Phase 3: ISBN auto-fill, search, My Shelf, notes, highlights"
   git push
   ```
4. Vercel auto-deploys on push. Wait ~2 minutes.

### 2. No new environment variables needed

Phase 3 reuses everything already set up. Google Books and Open Library are public APIs with no key required.

### 3. No Firestore rule changes needed

The Phase 1 rules already grant members write access to their own
`reading_progress` doc (notes + highlights are fields on that doc, so they're
covered automatically).

---

## Testing Phase 3

1. **ISBN auto-fill** — `/admin/books/new` → paste `9780735211292` (Atomic Habits) → click *Auto-fill*. Title, authors, publisher, year, page count, description, language, and cover should pre-populate. Now type a custom subtitle; auto-fill won't overwrite it on a second lookup.
2. **Search** — Magnifying glass in the header. Try a partial author name or a word from a description. Results sort by relevance (title hits beat description hits).
3. **My Shelf** — *My Shelf* in the header. Start a book in the reader, then come back here — it should appear under *Currently reading*. Mark another as *Want to read* from its detail page; check *Want to read* tab.
4. **Notes** — Book detail → *Reader's notes* section → type. After ~800 ms it shows *Saved · HH:MM:SS*. Reload — the notes persist.
5. **Highlights — PDF** — Open a PDF book. Select 5+ characters of text. A floating *Save highlight* pill appears. Click it. A toast confirms. Back on the book's detail page, your highlight appears with the page number under *Highlights*.
6. **Highlights — EPUB** — Same flow, but the prompt appears at the top of the reader (EPUB iframes block per-page positioning).
7. **Remove a highlight** — Detail page → hover a highlight → small × in the corner.

---

## What's new on disk (Phase 3)

```
src/
├── app/
│   ├── api/books/fetch-isbn/route.ts   ★ Real ISBN lookup (Google Books → Open Library)
│   ├── library/
│   │   ├── search/page.tsx             ★ /library/search?q=…
│   │   └── shelf/page.tsx              ★ /library/shelf
│   └── book/[bookId]/page.tsx          ↻ Reader's notes + highlights gallery
├── components/
│   ├── admin/BookForm.tsx              ↻ IsbnFetcher replaces the two ISBN inputs
│   ├── library/Header.tsx              ↻ Search icon + My Shelf link
│   └── readers/
│       ├── PDFReader.tsx               ↻ Selection-based highlight capture
│       └── EPUBReader.tsx              ↻ Selection-based highlight capture
└── lib/
    └── progress.ts                     ↻ listUserProgress, watchUserProgress,
                                         saveNotes, addHighlight, removeHighlight
```

★ = new in Phase 3
↻ = modified

---

## Common Phase 3 snags

- **ISBN lookup returns 404** — some books legitimately aren't in either database. Type the metadata in manually; it doesn't block anything.
- **EPUB highlight prompt doesn't appear** — selections inside the iframe sometimes don't fire `selected` on the first try; release and re-select, or select a slightly longer span. Once you've highlighted once in a session it works reliably.
- **Highlight saved but doesn't show on the detail page** — the page subscribes to live progress updates but if you have two tabs open they each subscribe; if it doesn't appear immediately, reload.
- **My Shelf shows empty under "Currently reading" after opening a book** — the auto-status transition only fires after the first debounced save (1.5s after opening). Turn one page or wait a few seconds.
- **Search shows nothing for a word that's clearly in a book** — the search only matches *visible* fields (title, subtitle, authors, description). Classification labels aren't searchable yet; use the Browse filters instead.
