# Phase 4.5 — AI Curator's Assistant

Adds an **"AI Fill"** button to the admin book form. Type a title (and optionally
upload the PDF), click the button, and the AI populates everything: description,
classification across every dimension, "Why this book" curator note, and the
cover (via the AI's best-guess ISBN).

## What it does

1. You type a title (and optionally an author) into the admin form.
2. You either upload a PDF or skip that step.
3. You click **AI Fill**.
4. The server:
   - If a PDF was uploaded, extracts the first ~25 pages of text and sends it
     to Claude Sonnet 4.6 as grounding.
   - Asks Claude to classify the book across all dimensions using the exact
     taxonomy enum keys.
   - Takes Claude's best-guess ISBN and runs it through the existing 4-tier
     ISBN lookup to fetch the cover.
5. The response is merged into the form **only filling empty fields** —
   anything you've already typed is preserved.

## Setup — add one Vercel env var

1. Go to https://console.anthropic.com → sign up or log in
2. Top-right menu → **API Keys** → **Create Key** → name it `my-library-prod`
3. Copy the key (`sk-ant-api03-...`)
4. **Vercel** → your project → **Settings** → **Environment Variables** → **Add New**
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste the key
   - Environments: tick all three (Production, Preview, Development)
   - **Save**
5. **Redeploy** (Deployments tab → ⋯ on the latest → **Redeploy**)

That's it. Total setup time: ~2 minutes.

## Usage

`/admin/books/new`:

1. Type **Title**: e.g. `Atomic Habits`
2. (Optional) Type **Authors**: `James Clear` — improves AI accuracy for obscure books
3. (Optional) Drop the PDF onto the **PDF** uploader and wait for upload to finish
4. Click the big **AI Fill** button at the top
5. Wait ~5–15 seconds (longer if reading a PDF)
6. Review the populated fields. Anything you typed before clicking is untouched.
7. Adjust the classification chips if you disagree with the AI
8. Click **Save book & publish**

For obvious classics (Atomic Habits, Think and Grow Rich, etc.) the title alone
is enough. For obscure or recent books, upload the PDF — Claude will read the
first chapter and classify based on the actual contents.

## What the AI fills

Every field on the admin form:

| Field             | Source                                  |
| ----------------- | --------------------------------------- |
| title             | AI canonical form, or kept as you typed |
| subtitle          | AI                                      |
| authors           | AI (preserved if you typed any)         |
| description       | AI                                      |
| publisher         | AI (or ISBN lookup if AI omitted)       |
| publication_year  | AI                                      |
| page_count        | AI                                      |
| language          | AI                                      |
| isbn_13 / isbn_10 | AI's best guess, validated              |
| cover_url         | **Always** ISBN lookup (most reliable)  |
| why_this_book     | AI, written in second person            |
| life_domains      | AI, validated against enum              |
| life_stages       | AI, validated against enum              |
| rooms             | AI, validated against enum              |
| reader_level      | AI, validated against enum              |
| reading_modes     | AI, validated against enum              |
| cultural_contexts | AI, validated against enum              |
| outcomes          | AI free-form, normalized to snake_case  |
| fields            | AI free-form, normalized to snake_case  |

Server-side validation silently drops any classification key Claude invents
(e.g. if it tried `productivity` instead of the canonical
`productivity_time_management`).

## Cost

- Claude Sonnet 4.6 at $3/M input, $15/M output tokens
- Title-only call: ~3K input tokens + ~1.5K output ≈ **$0.03** per book
- With PDF text (first 25 pages, ~12K tokens): ~15K input + ~1.5K output ≈ **$0.07** per book

For a library that adds a few books a week, total monthly cost is well under $5.

## Failure modes

- **No `ANTHROPIC_API_KEY` set** — clear error message in the UI; deploy with the env var.
- **AI doesn't know the book** — for unknown books, the AI is instructed to leave classification fields empty rather than guess. You'll see filled metadata fields but empty taxonomy chips. Fill those manually.
- **AI suggests a wrong ISBN** — sanity-checked server-side (must be 13 digits starting with 978/979). If the lookup returns a different book, the cover may not match — you can clear it.
- **PDF extraction fails** — silently falls back to title-only and notes this in the success message at the bottom of the AI Fill panel.
- **Anthropic API timeout** — function has a 60s max duration. If it times out, retry without PDF (title-only is faster).

## Files added/changed

```
src/
├── app/api/books/
│   ├── ai-fill/route.ts      ★ Main endpoint — classifies + supplements with ISBN
│   └── fetch-isbn/route.ts   ↻ Refactored to use shared lookupIsbn helper
├── components/admin/BookForm.tsx  ↻ AiFiller component added at the top
└── lib/
    ├── anthropic.ts          ★ Claude API client + classifyBook
    ├── isbn-lookup.ts        ★ Shared ISBN lookup helper (extracted from old route)
    └── pdf-extract.ts        ★ Server-side PDF text extraction

.env.local.example            ↻ Adds ANTHROPIC_API_KEY entry
```

★ new
↻ modified
