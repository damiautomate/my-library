# Phase 8 — Quality & reliability pass

A focused pass on the issues that piled up from real use: bulk imports getting rate-limited, blurry covers, the PDF reader being cramped, the EPUB reader being unusable on mobile, the curator's note feeling generic, and the lack of any way to publish books in bulk.

## What's fixed and improved

### Anthropic rate limits no longer kill bulk imports

The `429 rate_limit_error` failures you were seeing during big bulk runs are gone. The Anthropic client now retries on 429 and 529 with exponential backoff (up to 5 attempts, respects the server's `Retry-After` header). A 30-book bulk import on a tier-1 account that used to half-fail will now complete — it just takes a bit longer when it hits the cap.

### Covers are sharp now

Switched all ISBN lookups to use Open Library's ISBN-based cover service (`https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg`). These serve ~500-1000px reliably, vs Google Books' default ~128px thumbnails that were causing the blurry-cover problem. Google Books is still the fallback when there's no ISBN.

### Curator's note finally sounds like a person

Major prompt rewrite. The AI no longer summarizes the book in the `why_this_book` field — that's what `description` is for. Instead it answers: "why should you spend your finite time on THIS book?"

Banned phrases: `must-read`, `life-changing`, `transformative`, `essential reading`, opening with `This book...`, opening with the book's name. Required behavior: speak to specific stakes, name the actual shift the book produces, sound conversational. Three example notes embedded in the system prompt anchor the tone.

Existing books still have their old notes — but any new book added (or any book you regenerate with AI Fill) gets the new style. Sample tone from the prompt:

> *"Most habit books treat you like a project to optimize. Clear treats you like a person who's already trying their best with bad maps. The reframe — that you don't rise to your goals, you fall to your systems — is one of those ideas that gets quieter and more useful the longer you sit with it."*

### AI is more willing to guess ISBNs

Old prompt: "isbn_13: the canonical 13-digit ISBN **if you know it confidently**, otherwise omit." That made the AI conservative — it rarely volunteered an ISBN. New prompt explicitly tells it that a near-correct guess is more useful than nothing because we validate downstream, so it should make a confident attempt for any reasonably well-known book. This fixes most cases where bulk-import books had no cover.

### ISBN field auto-fetches when you type one

If you manually enter an ISBN into the form, you no longer need to click the **Auto-fill** button. After a 1.5s debounce, a valid 10 or 13-digit ISBN triggers the lookup automatically and fills the cover.

### Bulk publish — two places

1. **On the bulk import page**: when a run finishes, the progress header shows a **Publish N** button. One click publishes everything that completed successfully.
2. **On the catalogue (`/admin/books`)**: every row has a checkbox now, plus a select-all in the header. Pick any combination of books and use the bulk action bar that appears at the top: **Publish**, **Unpublish**, or **Archive**. Selected rows highlight oxblood.

Both use the same `/api/books/bulk-update` endpoint — batched Firestore writes, capped at 500 books per call, admin-only.

### Bulk import quick link on the dashboard

The Librarian's Desk now has four quick links instead of three: **Manage books · Bulk import · Invitations · Members**.

### EPUB reader on mobile is actually usable now

The "huge gaps between words, only six words per line" problem was caused by CSS text-justification combined with react-reader's internal `.swipeable` padding stealing ~50-80px of horizontal space on a 360px phone screen.

Fixes:

- `text-align: left !important` on body and paragraphs — no more justification, packs words tightly
- Default font size is now 85% on mobile (auto-detected at mount), 95% on desktop — both starting points were too large
- `padding: 0` and `margin: 0` on the iframe body
- CSS overrides on `.swipeable` and `.reactReaderContainer__viewerHolder` reclaim padding (14px desktop, 8px mobile)
- Internal arrow buttons hidden on mobile (toolbar arrows are the canonical navigation)
- Line-height tightened from 1.55 to 1.5
- Paragraph bottom margin reduced from 0.8em to 0.6em

Result: roughly double the text per page on mobile.

### PDF reader: a beautiful, navigable reading experience

This was a rewrite, not a tweak. The new reader has:

**Navigation**:
- **Tap zones** — left third of the page goes back, right third goes forward (mobile)
- **Swipe gestures** — horizontal swipe of 50px+ at any speed flips the page
- **Keyboard** — ← → PageUp PageDown Home End for nav, + − for zoom
- **Page input** — the page number is an editable field; type `245` and press Enter to jump
- A first-time hint appears on mobile after the first page loads: "Tap left / right · swipe · ← → keys"

**Visual**:
- Always-visible thin oxblood progress bar at the top of the reader
- **Auto-hiding toolbar** — fades after 3 seconds of inactivity, any input reveals it (mouse move, touch, keypress)
- **Fullscreen toggle** in the toolbar (uses browser fullscreen API)
- Page renders at the actual measured container width — no more horizontal scrollbars on mobile, no clipping
- Touch targets sized up from `p-1.5` to `p-2` for easier mobile tapping

**Error display** now mentions the Cloudinary PDF-delivery setting if loading fails, so future failures are diagnosable.

### Error message hint for Cloudinary PDF blocking

If your Cloudinary settings ever revert (or someone forks the project), the PDF reader's error box now says:

> "If you've just connected this library to a new Cloudinary account, make sure 'PDF and ZIP files delivery' is enabled under Cloudinary Console → Settings → Security."

So the next person who hits the issue knows exactly what to fix.

## Files added/changed

```
src/
├── app/
│   ├── admin/
│   │   ├── page.tsx                              ↻ Adds Bulk import quick link
│   │   ├── books/page.tsx                        ↻ Adds checkboxes + bulk action bar
│   │   └── books/bulk/page.tsx                   ↻ Adds "Publish all done" button
│   ├── api/books/bulk-update/route.ts            ★ Batched status updates
│   └── globals.css                               ↻ EPUB swipeable padding overrides
├── components/
│   ├── admin/BookForm.tsx                        ↻ Auto-fetch on ISBN entry (1.5s debounce)
│   └── readers/
│       ├── EPUBReader.tsx                        ↻ Typography overhaul; mobile-friendly defaults
│       └── PDFReader.tsx                         ↻ Full rewrite: tap zones, swipe, keyboard, fullscreen, page input, auto-hide toolbar
└── lib/
    ├── anthropic.ts                              ↻ Retry-on-429 with backoff; curator's note rewrite; ISBN willingness; 3000 max_tokens
    └── isbn-lookup.ts                            ↻ Open Library ISBN-based covers (large) as primary
```

★ new
↻ modified

## Deploy

```bash
unzip -o my-library-phase8.zip -d /tmp/p8
cp -r /tmp/p8/my-library/. .
rm my-library-phase8.zip
git add -A
git commit -m "Phase 8: rate-limit retries, beautiful PDF UX, EPUB density, curator's note rewrite, bulk publish"
git push
```

No env var changes. No Firestore rule changes.

## Still pending

**PDF → EPUB conversion** — this is its own focused build (server-side text extraction + EPUB packaging with JSZip). Next session. The plan: extract text per page with pdfjs-dist (already in use), detect chapter breaks heuristically (TOC if available, else N-page chunks), generate XHTML files, package as a minimal EPUB with manifest/spine/NCX. Upload to Cloudinary as the book's `epub_url`. Won't preserve images or complex layout (those need a Calibre-class tool we can't run on Vercel), but for text-heavy books it'll produce a navigable EPUB that works in the reader.

**Voice reader (TTS)** — still waiting on your A/B/C decision: ElevenLabs premium ($0.30/book, audiobook quality, sentence-sync highlights), Web Speech API (free, browser-native, OK quality), or both (premium when generated, free fallback).

## What to test after deploy

1. **Bulk import 10 books** by title — should complete without `rate_limit_error` failures
2. **Open a few books** and check the covers — should be visibly sharper, especially well-known titles with ISBNs
3. **Read an AI-generated curator's note** — should sound personal, name a specific shift, not summarize the book
4. **Bulk publish** — go to /admin/books, tick a few drafts, click Publish in the bar that appears
5. **Open a PDF on mobile** — should fit the screen edge-to-edge; tap right side to advance; toolbar fades after 3 seconds
6. **Open an EPUB on mobile** — should have visibly more text per page than before
7. **Type a 13-digit ISBN** into the form's auto-fill field — wait 1.5s — cover should populate without clicking the button
