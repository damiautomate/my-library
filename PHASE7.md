# Phase 7 — Public-domain imports (Gutenberg + Standard Ebooks)

Adds a third tab to `/admin/books/bulk`: **Public domain**. Search Project Gutenberg, queue books, paste Standard Ebooks URLs, and the server downloads each into your Cloudinary, runs AI Fill, and creates a draft.

## What's new

**Three tabs now on the bulk page:**

1. **By titles** (Phase 5) — paste a list of book titles, AI classifies from training-data knowledge
2. **By PDF files** (Phase 6) — drop PDF files, AI reads first chapter of each
3. **Public domain** (Phase 7) — new

**Inside Public domain:**

- **Project Gutenberg search**: type a query (book title, author, subject), hit Search, see results with covers, click "Queue" to add to import list. English-language books only by default. The Gutendex API has the full ~70,000-book catalogue.
- **Standard Ebooks URLs**: paste one or more book-page URLs (one per line), click "Queue all". You can also paste any direct `.epub` or `.pdf` URL — works for other public-domain hosts too.
- **Queued sources preview**: shows what's lined up, with × to remove.
- **Import queued** button: kicks off the bulk run. Same progress table as the other tabs.

**For each queued source:**

1. Server fetches the EPUB (and cover if available) from the source
2. Cloudinary mirrors it (so it's served from your own infrastructure forever — no dependency on source uptime)
3. AI Fill runs to classify and write the curator's note
4. Saved as a draft with EPUB + cover attached

After it finishes, the row shows little badges for **EPUB**, **PDF**, **cover** indicating what was successfully fetched, plus an edit link.

## Why this is structured the way it is

**Why Gutenberg has a full search but Standard Ebooks doesn't.** Standard Ebooks gated their OPDS catalogue feed behind a Patrons Circle subscription ($10/year) so we can't search them programmatically. Their individual book pages remain public, so the URL-paste flow gets you the same end result — you just browse their site manually to find books, then paste the URL. If you decide to subscribe to support them, that's worth doing for other reasons; we don't strictly need it.

**Why Cloudinary mirroring instead of streaming from source.** Two reasons. First, public-domain hosts can rate-limit or go down — mirroring once gives you permanent local copies. Second, the existing file-proxy infrastructure expects Cloudinary URLs, so this keeps the reader pipeline uniform. The trade-off is Cloudinary storage usage — a typical EPUB is 500 KB to 2 MB, so even 500 books fit in well under 1 GB.

**Why we don't extract PDF text for grounding.** Gutenberg gives EPUBs, not PDFs — and server-side EPUB text extraction is more complex than PDF extraction. For now, public-domain imports run **title-only AI classification**, which is plenty for the well-known classics that dominate these catalogues (Marcus Aurelius, Plato, Sun Tzu, etc. — books the AI knows cold). If a particular import gives weak classification, you can edit it manually.

## How to test

After deploy:

1. Visit `/admin/books/bulk` → click **Public domain** tab
2. In the Gutenberg search box, type `meditations marcus aurelius` → **Search**
3. Click **Queue** on the top result
4. (Optional) Switch back and paste a SE URL like `https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long` into the SE textarea → **Queue all**
5. Click **Import queued**
6. Watch the rows in the progress table. After 20–40s each: should show **Done** with EPUB + cover badges.
7. Open the edit link on a done row — should have classification, "Why this book", description, language, all populated. The book is a Firestore draft with an EPUB on your Cloudinary.

## Files added/changed

```
src/
├── app/
│   ├── admin/books/bulk/page.tsx              ↻ Adds Public domain tab + Gutenberg/SE UI
│   └── api/books/
│       ├── import-source/route.ts             ★ Downloads source, uploads to Cloudinary, AI Fills, creates draft
│       └── search-gutenberg/route.ts          ★ Server-side Gutendex search (admin-only)
└── lib/
    ├── cloudinary-server.ts                    ★ uploadFromUrl helper (server-to-server pulls)
    ├── gutenberg.ts                            ★ Gutendex client + result normalization
    └── standard-ebooks.ts                      ★ SE URL parser + EPUB-URL prediction with fallback page scrape
```

★ new
↻ modified

Two new API routes, three new lib files, one file changed. No env var changes, no Firestore rule changes.

## What's next

The voice reader. I'm still waiting on the TTS provider decision: **ElevenLabs** (premium audiobook quality with sentence-level sync, $0.30/book), **Web Speech API** (free, browser-native, decent quality), or **both** (premium when generated, free fallback). Reply with A, B, or C when you're ready.

The 4-tab reader (PDF | Voice Reader | EPUB | Audio Summary), the PDF/EPUB/Voice progress sync, and the separate Audio Summary progress track are all designed and waiting on that decision.
