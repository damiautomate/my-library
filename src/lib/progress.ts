import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase/client";
import type { ReadingProgressDoc, ReadingStatus } from "./types";

const COL = "reading_progress";

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
  const ref = doc(db, COL, progressId(userId, bookId));
  const existing = await getDoc(ref);

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
          await saveProgress(userId, bookId, payload);
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
        await saveProgress(userId, bookId, payload);
      }
    },
  };
}
