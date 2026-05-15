# My Library — App 1

> A curated, invite-only digital library. Books classified across 26 life
> domains, 7 stages, 11 rooms. The storage and organisation foundation for
> a future Library Keeper (App 2).

**Phase 1 status: ✅ built.** What's working:

- Next.js 14 (App Router) + TypeScript + Tailwind
- Firebase Auth + Firestore data model + security rules
- Invitation allowlist enforced server-side
- Full taxonomy (26 domains, 7 stages, 11 rooms, etc.)
- Admin: add / edit / archive books with full classification
- Member: rooms grid, browse with multi-facet filters + search, room pages, book detail
- Design system: parchment / ink / oxblood / forest, Fraunces + IBM Plex Sans, paper grain

What's deliberately **not yet** built (per spec phasing):

- **Phase 2** — File uploads (Cloudinary), in-app PDF/EPUB readers, audio player, reading progress
- **Phase 3** — ISBN auto-fetch, My Shelf, notes, highlights
- **Phase 4** — Rooms grid atmosphere polish, Reader's Passport, mobile final pass

---

## 1. Setup

### Prerequisites

- Node 18.17+ (Node 20 LTS recommended)
- A Firebase project named `my-library` (create at https://console.firebase.google.com)
- The existing Cloudinary account `dvzk1it71` (needed from Phase 2 onward, but populate now)

### Install

```bash
npm install
```

### Configure Firebase

In the Firebase console for project `my-library`:

1. **Authentication** → Sign-in methods → enable **Email/Password** and **Google**
2. **Firestore Database** → Create database → **production mode**
3. **Project Settings** → General → scroll to "Your apps" → Add a Web App → register and copy the config values
4. **Project Settings** → Service Accounts → **Generate new private key** → download the JSON

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_FIREBASE_*` from the Web App config in step 3
- `FIREBASE_ADMIN_PROJECT_ID` — `my-library`
- `FIREBASE_ADMIN_CLIENT_EMAIL` — from the service account JSON (`client_email`)
- `FIREBASE_ADMIN_PRIVATE_KEY` — from the service account JSON (`private_key`), **wrapped in double-quotes** with `\n` literals preserved, e.g.
  ```
  FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
  ```
- `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` — from Cloudinary dashboard (account `dvzk1it71`)

### Deploy Firestore security rules

The `firestore.rules` file at the repo root is what Phase 1 ships. To deploy:

```bash
# Once, globally
npm install -g firebase-tools

firebase login
firebase use my-library
firebase deploy --only firestore:rules
```

(or paste the rules manually into Firestore → Rules in the console)

### Run

```bash
npm run dev
```

App will be at http://localhost:3000.

---

## 2. Bootstrapping the first admin (Damilare)

There are no admins on day 0. To make yourself the first admin:

1. Run the app and go to `/login`.
2. Click "I have an invitation — sign up" and try to sign up with your email + a password.
3. The signup will succeed in Firebase Auth, then the onboarding endpoint will **reject** you (no invitation), delete the auth user, and show an error. Good — that proves the allowlist works.
4. Open the Firestore console → create a new collection called `invitations`. Add a document with:

   | Field         | Type      | Value                                |
   | ------------- | --------- | ------------------------------------ |
   | `email`       | string    | your-email@example.com *(lowercase)* |
   | `role`        | string    | `admin`                              |
   | `status`      | string    | `pending`                            |
   | `invited_by`  | string    | `bootstrap`                          |
   | `created_at`  | timestamp | (use Firestore's "current time")     |

5. Go back to `/login` and sign up again with that same email. This time onboarding succeeds — your `users/{uid}` doc is created with `role: "admin"` and the invitation is marked `accepted`.
6. From now on, send all other invitations through `/admin/invitations` inside the app.

---

## 3. Project structure

```
my-library/
├── firestore.rules                  # Security rules (deploy with Firebase CLI)
├── .env.local.example               # Copy to .env.local and fill in
├── next.config.js
├── tailwind.config.ts               # Design tokens (parchment/ink/oxblood/forest)
├── tsconfig.json
├── package.json
└── src/
    ├── app/
    │   ├── layout.tsx               # Fonts (Fraunces, IBM Plex Sans/Mono) + AuthProvider
    │   ├── globals.css              # Paper grain overlay, chip/card primitives
    │   ├── page.tsx                 # Landing
    │   ├── login/page.tsx
    │   ├── library/                 # Rooms grid, browse, room detail
    │   ├── book/[bookId]/page.tsx   # Book detail (read-only — reader is Phase 2)
    │   ├── admin/                   # Dashboard, books CRUD, invites, members
    │   └── api/
    │       ├── users/onboard/       # Allowlist check after signup
    │       └── invitations/         # Admin-only invite mgmt
    ├── lib/
    │   ├── firebase/                # Client SDK + Admin SDK + auth helpers
    │   ├── taxonomy.ts              # ★ All 26 domains, 7 stages, 11 rooms, etc.
    │   ├── types.ts                 # BookDoc, UserDoc, InvitationDoc, ReadingProgressDoc
    │   └── books.ts                 # Firestore CRUD
    ├── components/
    │   ├── ui/                      # Button, Input, Select, Tag, Modal
    │   ├── library/                 # Header, BookCard, BookGrid, RoomCard, FilterSidebar, SearchBar, AuthGuard
    │   └── admin/                   # BookForm, ClassificationPicker
    └── contexts/
        └── AuthContext.tsx
```

---

## 4. Quick sanity check after install

After `npm install` runs cleanly, verify the build with:

```bash
npm run typecheck    # tsc --noEmit — should pass with zero errors
npm run build        # full Next.js production build
```

---

## 5. Deploy

Hobby tier on Vercel:

1. Push the repo to GitHub.
2. Connect the repo on https://vercel.com → "New Project".
3. Add **all** environment variables from `.env.local` into Vercel project settings.
4. Deploy. First build takes ~2 min.

The site will be live at `your-project.vercel.app`. Authorized domains in Firebase Console → Authentication → Settings need the Vercel domain added so Google sign-in works.

---

## 6. What I won't touch yet (Phase 2+)

Files that are scaffolded but return `501 Not Implemented`:

- `src/app/api/upload/sign/route.ts` — Cloudinary signed uploads (Phase 2)
- `src/app/api/books/fetch-isbn/route.ts` — Google Books / Open Library (Phase 3)

When we move to Phase 2 we'll fill these in, add `react-pdf` + `react-reader`, and surface the reader on `/book/[bookId]/read`.

---

## 7. Notes for App 2

The data model already carries `pairs_with`, `parent_books`, `child_books`,
`why_this_book`, and the full `outcomes` / `fields` arrays — no migration
needed when the Library Keeper goes in. See spec §20.
