import type { Timestamp } from "firebase/firestore";
import type {
  CulturalContext,
  LifeDomain,
  LifeStage,
  ReaderLevel,
  ReadingMode,
  Room,
} from "./taxonomy";

// ============================================================
// USERS
// ============================================================
export type UserRole = "admin" | "member";

export interface UserDoc {
  uid: string;
  email: string;
  display_name: string;
  photo_url?: string;
  role: UserRole;
  invited_by?: string;
  joined_at: Timestamp;
  last_active_at: Timestamp;
}

// ============================================================
// INVITATIONS
// ============================================================
export type InvitationStatus = "pending" | "accepted" | "revoked";

export interface InvitationDoc {
  email: string; // lowercase
  invited_by: string;
  role: UserRole;
  status: InvitationStatus;
  created_at: Timestamp;
  accepted_at?: Timestamp;
  expires_at?: Timestamp;
}

// ============================================================
// BOOKS
// ============================================================
export type BookStatus = "draft" | "published" | "archived";

export interface BookDoc {
  // Core metadata
  title: string;
  subtitle?: string;
  authors: string[];
  description?: string;
  cover_url?: string;
  isbn_10?: string;
  isbn_13?: string;
  publisher?: string;
  publication_year?: number;
  language: string;
  page_count?: number;
  estimated_reading_time_hours?: number;

  // Classification — multi-dimensional
  life_domains: LifeDomain[];
  life_stages: LifeStage[];
  rooms: Room[];
  reader_level: ReaderLevel;
  reading_modes: ReadingMode[];
  cultural_contexts: CulturalContext[];
  outcomes: string[];
  fields: string[];

  // Lineage (App 2 hooks — stored but unused in App 1 UI)
  pairs_with: string[];
  parent_books: string[];
  child_books: string[];

  // Curator voice
  why_this_book?: string;

  // Files (Cloudinary) — Phase 2
  pdf_url?: string;
  pdf_public_id?: string;
  epub_url?: string;
  epub_public_id?: string;
  audio_summary_url?: string;
  audio_summary_public_id?: string;
  audio_summary_duration_seconds?: number;

  // External links
  amazon_url?: string;
  okada_books_url?: string;
  external_url?: string;

  // System
  added_by: string;
  added_at: Timestamp;
  updated_at: Timestamp;
  status: BookStatus;
}

/** Book with its Firestore document ID attached. */
export type Book = BookDoc & { id: string };

// ============================================================
// READING PROGRESS
// ============================================================
export type ReadingStatus =
  | "want_to_read"
  | "currently_reading"
  | "finished"
  | "paused"
  | "abandoned";

export interface Highlight {
  id: string;
  page?: number;
  cfi?: string;
  text: string;
  note?: string;
  color?: "yellow" | "green" | "red" | "blue";
  created_at: Timestamp;
}

export interface ReadingProgressDoc {
  user_id: string;
  book_id: string;
  status: ReadingStatus;

  current_page?: number;
  current_percent?: number;
  current_cfi?: string;
  current_audio_seconds?: number;

  started_at?: Timestamp;
  last_read_at?: Timestamp;
  finished_at?: Timestamp;

  notes?: string;
  rating?: number;
  highlights?: Highlight[];
}
