import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  Timestamp,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "./firebase/client";
import type { Book, BookDoc, BookStatus } from "./types";
import type { LifeDomain, LifeStage, Room } from "./taxonomy";

const BOOKS = "books";

/** Default values for fields that must always be arrays. */
function withDefaults(input: Partial<BookDoc>): Partial<BookDoc> {
  return {
    authors: [],
    life_domains: [],
    life_stages: [],
    rooms: [],
    reading_modes: [],
    cultural_contexts: [],
    outcomes: [],
    fields: [],
    pairs_with: [],
    parent_books: [],
    child_books: [],
    language: "en",
    ...input,
  };
}

export async function createBook(
  data: Partial<BookDoc>,
  adminUid: string,
): Promise<string> {
  const ref = await addDoc(collection(db, BOOKS), {
    ...withDefaults(data),
    added_by: adminUid,
    added_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    status: data.status ?? "draft",
  });
  return ref.id;
}

export async function updateBook(
  id: string,
  data: Partial<BookDoc>,
): Promise<void> {
  await updateDoc(doc(db, BOOKS, id), {
    ...data,
    updated_at: serverTimestamp(),
  });
}

export async function archiveBook(id: string): Promise<void> {
  await updateBook(id, { status: "archived" });
}

export async function deleteBookForever(id: string): Promise<void> {
  await deleteDoc(doc(db, BOOKS, id));
}

export async function getBook(id: string): Promise<Book | null> {
  const snap = await getDoc(doc(db, BOOKS, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as BookDoc) };
}

export interface ListBooksOptions {
  status?: BookStatus;
  room?: Room;
  domain?: LifeDomain;
  stage?: LifeStage;
}

export async function listBooks(opts: ListBooksOptions = {}): Promise<Book[]> {
  const constraints: QueryConstraint[] = [];
  if (opts.status) constraints.push(where("status", "==", opts.status));
  if (opts.room) constraints.push(where("rooms", "array-contains", opts.room));
  if (opts.domain)
    constraints.push(where("life_domains", "array-contains", opts.domain));
  if (opts.stage)
    constraints.push(where("life_stages", "array-contains", opts.stage));

  // Firestore requires the orderBy field to be present on filtered queries; we
  // sort client-side after fetch to avoid composite-index requirements during
  // Phase 1. For Phase 3 we'll add the indexes and switch to server ordering.
  const q = query(collection(db, BOOKS), ...constraints);
  const snap = await getDocs(q);
  const books = snap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as BookDoc) }) as Book,
  );

  // Sort by added_at desc, treating missing timestamps as oldest.
  books.sort((a, b) => {
    const at = (a.added_at as Timestamp | undefined)?.toMillis?.() ?? 0;
    const bt = (b.added_at as Timestamp | undefined)?.toMillis?.() ?? 0;
    return bt - at;
  });

  return books;
}

/** Count books grouped by room — used for the rooms grid badge. */
export async function countBooksByRoom(): Promise<Record<string, number>> {
  const books = await listBooks({ status: "published" });
  const counts: Record<string, number> = {};
  for (const b of books) {
    for (const r of b.rooms ?? []) {
      counts[r] = (counts[r] ?? 0) + 1;
    }
  }
  return counts;
}
