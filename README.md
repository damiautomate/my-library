# My Library — App 1 (Phases 1 + 2)

> A curated, invite-only digital library. Books classified across 26 life
> domains, 7 stages, 11 rooms. The storage and organisation foundation for
> a future Library Keeper (App 2).

**Phase 2 status: ✅ built** — file uploads, in-app readers, reading progress,
shelf controls, and downloads are all live.

## What works now

**From Phase 1**
- Next.js 14 + TypeScript + Tailwind
- Firebase Auth + Firestore + security rules
- Invitation allowlist enforced server-side
- Full taxonomy (26 domains, 7 stages, 11 rooms, etc.)
- Admin book CRUD with full classification
- Rooms grid, browse with multi-facet filters, room pages, book detail
- Design system: parchment / ink / oxblood / forest, Fraunces + IBM Plex Sans, paper grain

**New in Phase 2**
- Signed Cloudinary uploads (PDF, EPUB, audio, cover) directly from the admin form
- Drag-and-drop `FileUploader` with live progress %, cancellation, replace, delete
- In-app **PDF reader** (`react-pdf`) — page navigation, zoom, keyboard arrows
- In-app **EPUB reader** (`react-reader`) — typography matched to the library, CFI persistence
- In-app **audio player** — scrub, ±15s skip, position persistence
- **Reading progress** auto-saved with debouncing + every 10s heartbeat
- **Auto-status transitions** — first save → currently_reading; ≥95% → "mark as finished?" nudge
- **Shelf controls** on book detail: want to read / currently reading / pause / finish
- **Mark-as-finished modal** with optional 5-star rating + closing note
- **Download buttons** that force `Content-Disposition: attachment` via Cloudinary's `fl_attachment` flag
- **Multi-mode reader** at `/book/[bookId]/read?mode=pdf|epub|audio` (switches between modes when multiple formats exist)
- Login page error messages are now human-readable (no more silent "Error")

## What's still ahead

- **Phase 3** — ISBN auto-fetch, `/library/search`, **My Shelf** page, notes, highlights
- **Phase 4** — Reader's Passport stats, atmospheric polish, mobile pass

---

## Online-only setup (since you're working in the browser)

These steps assume you already deployed Phase 1 successfully. If not, follow
Phase 1's bootstrap flow first.

### 1. Pull Phase 2 into your repo via Codespaces

1. Go to your `my-library` GitHub repo → green **Code** button → **Codespaces** tab → **Create codespace on main**.
2. Drag the `my-library-phase2.zip` into the file explorer (left panel).
3. In the terminal:
   ```bash
   # Backup .env.local.example & .gitignore in case there are differences
   unzip -o my-library-phase2.zip -d /tmp/p2
   # Overwrite working tree with Phase 2 (preserves your git history)
   cp -r /tmp/p2/my-library/. .
   rm my-library-phase2.zip
   git add -A
   git commit -m "Phase 2: file uploads, readers, reading progress"
   git push
   ```
4. Vercel auto-deploys on push. Wait ~2 minutes.

### 2. Confirm Cloudinary env vars are set in Vercel

Vercel → your project → **Settings** → **Environment Variables**. You should already have these from Phase 1 setup, but verify:

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` = `dvzk1it71`
- `CLOUDINARY_API_KEY` = (from Cloudinary dashboard)
- `CLOUDINARY_API_SECRET` = (from Cloudinary dashboard)
- `CLOUDINARY_FOLDER` = `my-library`

If any are missing, add them and trigger a redeploy (Deployments tab → ⋯ on the latest → **Redeploy**).

### 3. (Optional) Configure Cloudinary access controls

By default, uploaded files are public — anyone with the URL can read them. The
app guards the URL behind Firestore security rules (members must read the book
doc to discover the URL), so this is acceptable for App 1. If you want
something stricter in App 2, look up Cloudinary's **signed delivery URLs**.

### 4. No Firestore rule changes needed

The Phase 1 rules already cover `reading_progress` correctly. Members can only
write to their own progress docs (the rule `progressId.matches(request.auth.uid + "_.*")`
enforces this).

---

## Testing Phase 2

In a deployed environment:

1. Sign in as admin → `/admin/books/new`.
2. Pick a small public-domain PDF for a smoke test (Project Gutenberg has plenty).
3. Drop it on the PDF uploader; you should see a live progress bar.
4. Fill in title, authors, pick a Room, then click **Save book & publish**.
5. Go to `/book/<id>`. Click **Read inside**. The PDF should render.
6. Page-forward a few pages. Close the tab. Reopen `/book/<id>` — the page count is preserved, and **Resume reading** is now the primary action.
7. Try downloading the PDF via the **PDF** download link — Cloudinary should serve it with `Content-Disposition: attachment`.
8. Try Shelf actions (Want to read / Pause). Then go past 95% in the reader → the "Mark as finished?" banner should appear.

---

## File map (new in Phase 2)

```
src/
├── app/
│   ├── api/upload/
│   │   ├── sign/route.ts          ★ Real signed-upload endpoint
│   │   └── delete/route.ts        ★ Admin-only file deletion
│   └── book/[bookId]/
│       ├── page.tsx               ↻ Now with Read/Resume/Listen + shelf + finish modal
│       └── read/page.tsx          ★ Multi-mode reader route
├── components/
│   ├── admin/
│   │   ├── BookForm.tsx           ↻ Files section added
│   │   └── FileUploader.tsx       ★ Drag-and-drop with progress + replace + delete
│   ├── readers/
│   │   ├── PDFReader.tsx          ★ react-pdf, page-by-page, debounced progress
│   │   ├── EPUBReader.tsx         ★ react-reader, CFI-based progress
│   │   └── AudioPlayer.tsx        ★ HTML5 audio with scrub, skip, position persistence
│   └── library/
│       └── ReadingProgress.tsx    ★ Status pill + percent bar
└── lib/
    ├── cloudinary.ts              ★ Client-side upload helper + download URL builder
    └── progress.ts                ★ Reading progress CRUD with debounced saver
```

★ = new in Phase 2
↻ = modified

---

## Common Phase 2 snags

- **Upload fails with 401** — your ID token expired. Refresh the page and try again.
- **Upload fails with 500 "Cloudinary credentials missing"** — env vars not set in Vercel. See step 2 above.
- **PDF reader shows "Could not load this PDF"** — usually a CORS issue from your Cloudinary account having a restrictive delivery rule. Cloudinary's defaults are permissive, so this only happens if you've added custom rules. The PDF URL itself should still work in a new tab.
- **EPUB reader shows blank** — same as above; also check the file is a valid EPUB 2 or 3 zip.
- **"Mark as finished" banner doesn't appear** — only triggers at ≥95% progress. For audio, the percent only updates after a few seconds of playback because metadata has to load first.
