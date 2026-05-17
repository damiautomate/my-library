# Phase 5 — Bug fixes & bulk import

This drop fixes the three issues from your screenshots and adds bulk import. The voice reader is **next** and waiting on the TTS provider decision (see end of this doc).

## What's fixed

### 1. PDF reader: "Could not load this PDF"

**Root cause:** likely a quirk in cross-origin fetching between pdf.js and Cloudinary's raw resource delivery. CORS headers are actually fine, but something in the request semantics was failing — and the bare error message we showed gave no clue what.

**Fix:**

- **All book files now stream through our own server** via `/api/file/{bookId}/{kind}`. The reader fetches from same-origin, with `Content-Type: application/pdf` set explicitly. This kills every CORS / Content-Type edge case in one move.
- Auth-gated: only signed-in non-suspended users can pull files. Token passes via `?t=...` query param so pdf.js can use it directly.
- Range requests forwarded → audio scrubbing and partial PDF loads still work efficiently.
- The reader's worker switched from cdnjs to jsdelivr (mirrors npm exactly).
- If a PDF *does* fail in the future, the reader now shows the **actual error message** in a styled error box instead of "The file may be missing or corrupted."

### 2. Download buttons returning HTTP 400

**Root cause:** Cloudinary's `fl_attachment:filename` flag doesn't want a file extension in the filename. Your URL had `fl_attachment:The_7_Habits_of_Highly_Effective_People.pdf/...` — the `.pdf` broke URL parsing.

**Fix:**

- `downloadUrl()` in `lib/cloudinary.ts` now strips extensions and sanitizes special characters before building the URL.
- **Download buttons now use the file proxy too** — same `/api/file/{bookId}/{kind}?dl=1` route, which sets `Content-Disposition: attachment` server-side. More reliable than Cloudinary's flag, and respects auth.

### 3. EPUB reader: too little text, hard to navigate

**Fix:**

- Tighter typography: line-height 1.55 (from 1.65), font 1rem (from 1.05rem), reduced body padding, blockquote and heading styles applied. Visibly more text per page.
- New **toolbar** above the reader with: prev/next arrows, current chapter title, font size A− / A+ controls (70%–180%).
- Larger reader area (`min-h-[480px]`) so it never feels cramped.

---

## New: Bulk import

`/admin/books/bulk` — link is now in the **Bulk** button next to **Add book** on the admin catalogue page.

**How it works:**

1. Paste a list of titles, one per line. Three formats accepted:
   - Just `Title`
   - `Title | Author`
   - `Title — Author` (em dash or hyphen)
2. Click **Start import**.
3. The page processes 2 books in parallel through the AI Fill pipeline. Each takes 5–15 seconds.
4. Live progress table shows each book's status: Queued → AI… → Saving → Done.
5. Each completed book gets a small "edit" link to review and publish.

**Important:** bulk mode is **title-only** (no PDF text grounding) — for well-known books this is plenty. For obscure books, use the regular `/admin/books/new` flow with the PDF uploaded.

All books are created as **drafts** so you can review before publishing. You'll see exact field counts ("18 fields") so you know if classification ran or just metadata.

---

## What's still pending

### Voice reader (TTS) — needs your decision

You asked for a 4-tab reader: PDF, Voice Reader, EPUB, Audio Summary. I need one decision before building.

**Option A — ElevenLabs (premium)**
- Pre-generate audio at upload time, store on Cloudinary
- Audiobook quality, indistinguishable from human narration
- Sentence-level timing → highlights current sentence in the text as it reads
- Costs ~$0.30 per book (~$20/mo for 60 books on the Creator tier)
- Requires an ElevenLabs account

**Option B — Web Speech API (free)**
- Built into every modern browser, no API key, no storage
- Works the moment you click play
- Quality is "decent" — much better on Mac/iOS, more robotic on Windows
- No pre-generation; uses live TTS in the browser

**Option C — Both** (premium when available, free fallback)
- Admin can trigger "generate premium audio" per book
- If premium audio exists, play it (with sync highlights)
- Otherwise fall back to Web Speech API
- Best UX, most code

**Sync behaviour for all three options** (this is the same regardless):
- PDF / EPUB / Voice Reader all read the same content, so progress is shared
- Closing the voice reader at sentence 142 → opening PDF goes to that page
- Audio Summary tracks separately because it's different content (the spoken book summary)

Tell me which option and I'll build it.

---

## Files added/changed

```
src/
├── app/
│   ├── api/file/[bookId]/[kind]/route.ts   ★ Streaming proxy for book files
│   ├── admin/books/
│   │   ├── page.tsx                        ↻ "Bulk" button added
│   │   └── bulk/page.tsx                   ★ Bulk import UI
│   ├── book/[bookId]/page.tsx              ↻ DownloadLink uses file proxy
│   └── book/[bookId]/read/page.tsx         ↻ Reader uses proxy URLs
├── components/readers/
│   ├── EPUBReader.tsx                      ↻ Toolbar, font controls, density
│   └── PDFReader.tsx                       ↻ Real error display, jsdelivr worker
└── lib/cloudinary.ts                       ↻ downloadUrl fixed, proxyFileUrl added
```

★ new
↻ modified

---

## Testing

After deploy, in order:

1. **Open any book** → click **Read** → PDF tab. The PDF should load. If it doesn't, the error message will now show the real reason and we can fix it specifically.
2. **Download button** — click PDF or EPUB on a book detail page. File downloads with a clean filename like `Atomic_Habits.pdf`.
3. **EPUB tab** — open a book with an EPUB. Toolbar should show arrows, chapter title (if the EPUB has nav), and A−/A+ buttons. Click A+ a few times — text gets bigger. Use the arrows to flip pages.
4. **Bulk import** — `/admin/books/bulk` → paste:
   ```
   Atomic Habits | James Clear
   Deep Work | Cal Newport
   The 7 Habits of Highly Effective People — Stephen R. Covey
   ```
   → Start import. Wait ~30s for all three. Each appears as a Done row with an edit link. Open the edits and check classification is sensible.

If anything fails, please share the actual error message — the proxy + better error reporting means we'll have something specific to act on now.
