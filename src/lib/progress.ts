import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  where,
} from "firebase/firestore";
import { db } from "./firebase/client";
import type { Highlight, ReadingProgressDoc, ReadingStatus } from "./types";

const COL = "reading_progress";

/**
 * Sentinel userId for anonymous share-page viewers (Phase 9t). They have no
 * account, so their reading position is persisted to localStorage instead of
 * Firestore. Passing this as the userId to makeDebouncedSaver / saveProgress
 * transparently routes saves to localStorage — the reader components don't
 * need to know whether they're in member or guest mode.
 */
export const GUEST_USER_ID = "__guest__";

function guestKey(bookId: string): string {
  return `ml.guestProgress.${bookId}`;
}

/** Read a guest viewer's locally-saved progress for a book. Returns null when
 * none exists or localStorage is unavailable (SSR / privacy mode). */
export function getGuestProgress(bookId: string): SavePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(guestKey(bookId));
    return raw ? (JSON.parse(raw) as SavePayload) : null;
  } catch {
    return null;
  }
}

/** Merge-and-save a guest viewer's progress to localStorage. */
function saveGuestProgress(bookId: string, p: SavePayload): void {
  if (typeof window === "undefined") return;
  try {
    const prev = getGuestProgress(bookId) ?? {};
    window.localStorage.setItem(
      guestKey(bookId),
      JSON.stringify({ ...prev, ...p }),
    );
  } catch {
    // localStorage full / blocked — non-fatal, progress just won't persist.
  }
}

function progressId(userId: string, bookId: string): string {
  return `${userId}_${bookId}`;
}

export async function getProgress(
  userId: string,
  bookId: string,
): Promise<ReadingProgressDoc | null> {
  const snap = await getDoc(doc(db, COL, progressId(userId, bookId)));
  return snap.exists() ? (snap.data() as ReadingProgressDoc) : null;
}

export function watchProgress(
  userId: string,
  bookId: string,
  cb: (p: ReadingProgressDoc | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, COL, progressId(userId, bookId)), (snap) => {
    cb(snap.exists() ? (snap.data() as ReadingProgressDoc) : null);
  });
}

export interface SavePayload {
  current_page?: number;
  current_percent?: number;
  current_cfi?: string;
  current_audio_seconds?: number;
  /** Exact voice position — segment index + seconds within that segment. Used
   * to restore the audio element to the precise pause point on next mount. */
  current_voice_segment_index?: number;
  current_voice_seconds?: number;
}

/**
 * Save reading progress. On first save for a book, marks the user as currently
 * reading and stamps started_at. Always touches last_read_at.
 */
export async function saveProgress(
  userId: string,
  bookId: string,
  payload: SavePayload,
): Promise<void> {
  // Guest (share-page) viewers have no account and no Firestore write
  // permission — persist to localStorage instead. This also catches the
  // direct saveProgress call in VoiceReader's page-unload handler.
  if (userId === GUEST_USER_ID) {
    saveGuestProgress(bookId, payload);
    return;
  }

  const ref = doc(db, COL, progressId(userId, bookId));
  const existing = await getDoc(ref);

  // Always record today as a reading day on the user document. arrayUnion is
  // idempotent — repeated saves on the same day don't grow the array. We use
  // UTC dates here; the passport renders them in the user's local TZ.
  const today = new Date().toISOString().slice(0, 10);
  void setDoc(
    doc(db, "users", userId),
    { reading_days: arrayUnion(today) },
    { merge: true },
  ).catch((e) => console.warn("[progress] reading_days update failed", e));

  if (!existing.exists()) {
    await setDoc(ref, {
      user_id: userId,
      book_id: bookId,
      status: "currently_reading" satisfies ReadingStatus,
      started_at: serverTimestamp(),
      last_read_at: serverTimestamp(),
      ...payload,
    });
    return;
  }

  // Merge — preserve user-set status (paused, finished, etc.) unless they
  // haven't started yet.
  const data = existing.data() as ReadingProgressDoc;
  const next: Partial<ReadingProgressDoc> = {
    ...payload,
    last_read_at: serverTimestamp() as unknown as ReadingProgressDoc["last_read_at"],
  };
  if (data.status === "want_to_read") {
    next.status = "currently_reading";
    if (!data.started_at) {
      next.started_at = serverTimestamp() as unknown as ReadingProgressDoc["started_at"];
    }
  }
  await setDoc(ref, next, { merge: true });
}

export async function setStatus(
  userId: string,
  bookId: string,
  status: ReadingStatus,
): Promise<void> {
  const ref = doc(db, COL, progressId(userId, bookId));
  const patch: Partial<ReadingProgressDoc> = {
    user_id: userId,
    book_id: bookId,
    status,
    last_read_at: serverTimestamp() as unknown as ReadingProgressDoc["last_read_at"],
  };
  if (status === "finished") {
    patch.finished_at = serverTimestamp() as unknown as ReadingProgressDoc["finished_at"];
    patch.current_percent = 100;
  }
  if (status === "currently_reading") {
    const existing = await getDoc(ref);
    if (!existing.exists() || !existing.data()?.started_at) {
      patch.started_at = serverTimestamp() as unknown as ReadingProgressDoc["started_at"];
    }
  }
  await setDoc(ref, patch, { merge: true });
}

export async function setRatingAndNotes(
  userId: string,
  bookId: string,
  rating: number | null,
  notes: string | null,
): Promise<void> {
  const ref = doc(db, COL, progressId(userId, bookId));
  const patch: Partial<ReadingProgressDoc> = {};
  if (rating !== null) patch.rating = rating;
  if (notes !== null) patch.notes = notes;
  await setDoc(ref, patch, { merge: true });
}

/**
 * Returns a debounced save function. Calls collapse within `wait` ms; the
 * trailing call's payload is the one that gets persisted.
 */
export function makeDebouncedSaver(
  userId: string,
  bookId: string,
  wait = 1500,
): {
  save: (p: SavePayload) => void;
  flush: () => Promise<void>;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SavePayload | null = null;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const payload = pending;
      pending = null;
      timer = null;
      if (payload) {
        try {
          if (userId === GUEST_USER_ID) {
            saveGuestProgress(bookId, payload);
          } else {
            await saveProgress(userId, bookId, payload);
          }
        } catch (e) {
          console.error("[progress] save failed", e);
        }
      }
    }, wait);
  }

  return {
    save(p: SavePayload) {
      pending = { ...(pending ?? {}), ...p };
      schedule();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) {
        const payload = pending;
        pending = null;
        if (userId === GUEST_USER_ID) {
          saveGuestProgress(bookId, payload);
        } else {
          await saveProgress(userId, bookId, payload);
        }
      }
    },
  };
}

// ----------------------------------------------------------------------------
// List + highlights + notes
// ----------------------------------------------------------------------------

/** All progress docs for one user. Used by My Shelf. */
export async function listUserProgress(
  userId: string,
): Promise<ReadingProgressDoc[]> {
  const snap = await getDocs(
    query(collection(db, COL), where("user_id", "==", userId)),
  );
  return snap.docs.map((d) => d.data() as ReadingProgressDoc);
}

/** Subscribe to all of a user's progress docs (live updates for the shelf). */
export function watchUserProgress(
  userId: string,
  cb: (docs: ReadingProgressDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL), where("user_id", "==", userId)),
    (snap) => cb(snap.docs.map((d) => d.data() as ReadingProgressDoc)),
  );
}

/** Save the free-form notes field. Debounced caller recommended. */
export async function saveNotes(
  userId: string,
  bookId: string,
  notes: string,
): Promise<void> {
  await setDoc(
    doc(db, COL, `${userId}_${bookId}`),
    {
      user_id: userId,
      book_id: bookId,
      notes,
      last_read_at: serverTimestamp(),
    },
    { merge: true },
  );
}

/** A small id helper for highlights — short, sortable, no extra deps. */
function highlightId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface NewHighlight {
  page?: number;
  cfi?: string;
  text: string;
  note?: string;
  color?: Highlight["color"];
}

export async function addHighlight(
  userId: string,
  bookId: string,
  h: NewHighlight,
): Promise<Highlight> {
  const newH: Highlight = {
    id: highlightId(),
    page: h.page,
    cfi: h.cfi,
    text: h.text,
    note: h.note,
    color: h.color ?? "yellow",
    created_at: Timestamp.now(),
  };
  await setDoc(
    doc(db, COL, `${userId}_${bookId}`),
    {
      user_id: userId,
      book_id: bookId,
      highlights: arrayUnion(newH),
      last_read_at: serverTimestamp(),
    },
    { merge: true },
  );
  return newH;
}

export async function removeHighlight(
  userId: string,
  bookId: string,
  highlight: Highlight,
): Promise<void> {
  await setDoc(
    doc(db, COL, `${userId}_${bookId}`),
    {
      highlights: arrayRemove(highlight),
    },
    { merge: true },
  );
}
