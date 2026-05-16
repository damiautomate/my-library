# My Library — App 1 (Complete)

> A curated, invite-only digital library. Books classified across 26 life
> domains, 7 stages, 11 rooms. The storage and organisation foundation for
> a future Library Keeper (App 2).

**App 1 status: ✅ complete.** All four phases shipped.

## What works

**Phase 1 — Foundation**
- Next.js 14 + TypeScript + Tailwind, design system, taxonomy (26 domains / 7 stages / 11 rooms)
- Firebase Auth with invite allowlist; Firestore + security rules
- Admin book CRUD; rooms grid; browse with facet filters; book detail

**Phase 2 — Files & Reading**
- Signed Cloudinary uploads (PDF, EPUB, audio, cover) with progress bars
- In-app PDF, EPUB, and audio readers with debounced progress saves
- Auto-status transitions; "mark as finished" rating + closing-note modal
- Download buttons

**Phase 3 — Discovery & Personal Layer**
- ISBN auto-fill with 4-tier fallback (Google Books exact, Google Books text, Open Library /isbn, Open Library /api/books)
- Library-wide search with ranked scoring
- My Shelf with status tabs and live updates
- Private per-book notes (auto-saved)
- Highlight capture in PDF and EPUB readers
- Highlights gallery on book detail

**Phase 4 — Polish & Atmosphere**
- **Reader's Passport** at `/library/passport` — hero stats, streak detail, contribution calendar, breakdowns by room/domain/stage, top authors, recent finishes
- **Real reading streaks** — every save appends today's date to `users.{uid}.reading_days` via `arrayUnion`; current + longest computed in the user's local timezone
- **Role management** — admins can promote, demote, suspend, restore from `/admin/users`. Last-active-admin demote/suspend is blocked server-side. Suspended users are signed out automatically.
- **Atmospheric rooms grid** — each room has its own tint + accent color + decorative Roman numeral; asymmetric layout for visual rhythm
- **Mobile pass** — slide-in hamburger drawer in the header on screens narrower than `lg`; filter sidebar becomes a "Filters" button + slide-in drawer with sticky "Show results"; landing hero scales down on phones; EPUB reader gains a `min-h` floor so it never collapses
- **Time-of-day greeting** on the library home (`Good evening, Damilare`)
- **Continue reading** strip on the library home — only shown when you have an active book

---

## Online-only deploy (same as before)

### 1. Pull Phase 4 into your Codespace

1. Open your `my-library` repo on GitHub → green **Code** → **Codespaces** → reopen or create a fresh one.
2. Drag the `my-library-phase4.zip` into the file explorer.
3. Terminal:
   ```bash
   unzip -o my-library-phase4.zip -d /tmp/p4
   cp -r /tmp/p4/my-library/. .
   rm my-library-phase4.zip
   git add -A
   git commit -m "Phase 4: passport, streaks, mobile pass, room polish, role mgmt"
   git push
   ```
4. Vercel auto-deploys. ~2 minutes.

### 2. No new environment variables

Reuses everything you've already set: Firebase client + admin, Cloudinary, Google Books API key.

### 3. No Firestore rule changes

Phase 1 rules already allow:
- Users to update their own doc (and that update now includes `reading_days`)
- Admins to update other users' docs (and that update now includes `role` and `disabled`)

---

## Testing Phase 4

1. **Reader's Passport** — sign in → top nav → **Passport**. Should show all zeros if you haven't read anything yet. Open a book and turn a few pages, then return to Passport — current streak goes to 1, today's cell in the calendar lights up. Mark a book finished — recents row populates, byRoom/byDomain breakdowns fill in.
2. **Streak behaviour** — close the app, come back tomorrow, turn a page, refresh Passport: streak should be 2. Skip a day, come back the day after: streak resets to 1, longest streak still holds the higher number.
3. **Mobile** — open the deployed URL on your phone (or Chrome DevTools device-mode at 375×667). Tap the hamburger → all routes accessible. On `/library/browse` tap the **Filters** button → drawer appears → pick a few facets → **Show results**.
4. **Atmospheric polish** — `/library` desktop view should show the rooms grid with visibly different tints per room and a faint Roman numeral on each card.
5. **Role management** — `/admin/users`:
   - Click **Promote** on a member → they become admin (visible in their next session's header)
   - Click **Demote** on the only other admin → succeeds
   - Click **Demote** on yourself → button shows "Use another admin" — you can't.
   - Try **Suspend** on another admin when you'd be the only one left → 409 error with the safety message.
6. **Suspended user** — suspend a test account. If that account is signed in elsewhere, it should bounce to `/?suspended=1` within seconds (Firestore live snapshot). If they try to sign in again, they'll get past Firebase Auth but the AuthGuard immediately signs them back out.

---

## What's new on disk (Phase 4)

```
src/
├── app/
│   ├── api/users/role/route.ts          ★ Role + suspend endpoint with last-admin safety
│   └── library/passport/page.tsx        ★ Reader's Passport
├── components/library/
│   ├── AuthGuard.tsx                    ↻ Bounces suspended users
│   ├── FilterSidebar.tsx                ↻ Mobile drawer
│   ├── Header.tsx                       ↻ Mobile hamburger drawer
│   └── RoomCard.tsx                     ↻ Per-room tints + Roman numerals
└── lib/
    ├── passport.ts                      ★ Streak + stats computation
    ├── progress.ts                      ↻ Appends to users.reading_days on save
    └── types.ts                         ↻ UserDoc gains reading_days + disabled
```

★ = new in Phase 4
↻ = modified

---

## Done with App 1

The library is now a complete, working, deployable product. Next step is **App 2 — Library Keeper**, the AI conversational layer that talks to the same Firestore data: "what should I read next?", "what's the right Counting Room book for stage 4?", "I've finished Atomic Habits — what pairs with it?".

App 2 lives in a separate repo and only reads from the data model App 1 owns. The `pairs_with` / `parent_books` / `child_books` fields on `books` are already there waiting, the `outcomes` and `fields` arrays carry the semantic tags App 2 needs, and `reading_progress` gives it your reading history to ground recommendations in. No App 1 data migration will be needed.

When you're ready to start App 2, give me the App 2 spec the same way you gave me this one.
