# Phase 6 — Bulk PDF upload

Adds a second mode to `/admin/books/bulk`: drop a folder of PDFs, and each gets uploaded → AI-classified-from-content → saved as a draft. All in parallel.

## What changed

The bulk import page now has two tabs:

**By titles** (existing) — Paste titles, AI classifies each from training-data knowledge alone. Fast (~5–15s per book). Best for well-known books.

**By PDF files** (new) — Drop PDFs onto the dropzone or click to select. For each file:
1. Uploads to Cloudinary (with live progress bar)
2. The AI reads the first ~25 pages of the actual file
3. Classifies based on real content (much more accurate than title-only)
4. Saves as a draft with the PDF already attached

Both modes process **2 books in parallel** to balance throughput against rate limits (Anthropic API, Cloudinary upload concurrency).

## How to use the PDF mode

1. Go to `/admin/books/bulk` → click **By PDF files** tab
2. Drag a folder of PDFs onto the dropzone, or click and multi-select files
3. The list shows: filename → derived title → file size, with a × to remove any
4. Click **Upload & import**
5. Each row goes through: queued → uploading (with %) → AI… → saving → done
6. Click the edit icon on any done row to review/publish that book

## Filename → title heuristic

The initial title comes from the filename: `the_7_habits_of_highly_effective_people.pdf` becomes `The 7 Habits Of Highly Effective People`. The AI then canonicalizes this in its response, so a messy filename usually gets cleaned up automatically. Underscore, hyphen, and multi-space normalization included.

## Speed and cost expectations

- **Per-book time**: 15–30s (upload time depends on PDF size + your internet upload speed, then AI takes 5–10s)
- **AI cost**: ~$0.07/book with PDF text (vs ~$0.03/book title-only, per Phase 4.5 docs)
- **Cloudinary upload**: free up to your storage quota (25 GB on the free tier)
- **For 100 books**: ~30–50 minutes total wall-clock, ~$7 in Anthropic costs

## Constraints worth knowing

- 200 MB max per PDF (configured in `MAX_BYTES.pdf` in `lib/cloudinary.ts`)
- Files don't persist if you navigate away mid-import — keep the tab open until done
- Failed rows show the actual error message so you know what to retry
- Drafts are created — nothing's published until you review each one

## Files changed

```
src/app/admin/books/bulk/page.tsx    ↻ Adds PDF tab, dropzone, upload pipeline
```

Just that one file — everything else (upload signing, AI fill, PDF extraction, book create) was already in place from earlier phases. Phase 6 just composes them.

## What's next

Project Gutenberg + Standard Ebooks integration. The plan:

- New `/admin/books/gutenberg` page (or a third tab on bulk)
- Search Project Gutenberg's Gutendex API: `https://gutendex.com/books?search=...`
- Each result shows title, authors, available formats, language
- "Add to library" downloads the EPUB (and PDF if available) directly into your Cloudinary, runs AI Fill, saves as draft
- Same for Standard Ebooks (smaller catalogue, higher quality)

Public-domain only by definition, so legitimate, and gives you a clean source for the philosophy / classics / Hall of Elders portion of your library.

That's the next drop unless you want the voice reader first.
