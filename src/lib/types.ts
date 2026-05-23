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
  /** YYYY-MM-DD strings (UTC). Appended in saveProgress for streaks. */
  reading_days?: string[];
  /** When true, the member is suspended. Auth still works but the AuthGuard kicks them out. */
  disabled?: boolean;
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
  /** True if this EPUB was machine-converted from the PDF (vs uploaded directly). */
  epub_converted_from_pdf?: boolean;
  /** Map of EPUB chapter -> PDF source page. Lets the EPUB reader navigate to
   * the matching chapter when an external reader (Voice/PDF) is at a given
   * page. Only populated for EPUBs converted from PDF. */
  epub_chapter_map?: EpubChapterMapping[];
  audio_summary_url?: string;
  audio_summary_public_id?: string;
  audio_summary_duration_seconds?: number;

  /** Full-book narration audio, generated from the PDF via TTS — Phase 9. */
  voice_segments?: VoiceSegment[];
  voice_provider?: "google" | "aws" | "elevenlabs";
  voice_total_seconds?: number;
  /** Total expected number of voice segments for this book (Phase 9s.3).
   * Written by generate-voice on each segment-save alongside the segment
   * itself, so the client can compare voice_segments.length to this and
   * detect a partial / interrupted generation. When segments.length equals
   * voice_total_segments, voice generation is complete. When less, an
   * earlier run was interrupted and the next click should "Resume" (no
   * reset) rather than "Re-generate" (full reset). Undefined on books
   * generated before 9s.3 — those are treated as complete to preserve the
   * old behavior. */
  voice_total_segments?: number;
  /** Cloudinary raw URL of the cached PDF extraction JSON (Phase 9o). The
   * generate-voice route extracts the entire PDF once on the first segment
   * call (10-30s for big books), then caches the result here so subsequent
   * segment calls fetch a small JSON instead of re-parsing the PDF. This
   * keeps each call under Vercel's 60s function timeout. Cleared on the
   * client's reset=true call so a new PDF triggers a fresh extraction. */
  voice_extraction_url?: string;
  /** Google TTS voice name used for this book's audio (Phase 9q). Exact
   * IDs from VOICE_CATALOG in src/lib/voices.ts. Undefined means "use the
   * default narrator" — preserves backward compat for books generated before
   * the picker existed. When this is changed and differs from the voice that
   * actually generated existing segments, generate-voice auto-resets so we
   * never end up with a book whose audio is a mix of two voices. */
  voice_id?: string;
  /** Narration mode — derived from the chosen voice's catalog entry. "synced"
   * uses Neural2/News voices that support SSML mark timepoints (paragraph
   * highlight sync). "premium" uses Studio/Chirp voices (best audio quality
   * but no live highlight). Stored on the book so the player can show a
   * "Premium audio" indicator and disable highlight UI when relevant. */
  voice_mode?: "synced" | "premium";

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

/**
 * Mapping of EPUB chapters to PDF source pages — generated during PDF→EPUB
 * conversion. Lets us answer "what EPUB chapter contains PDF page N?" for
 * inter-reader navigation.
 */
export interface EpubChapterMapping {
  index: number;
  source_page_start: number;
  /** EPUB internal href like "chapter5.xhtml" — what epub.js navigates to. */
  href: string;
  title: string;
}

/**
 * One chunk of TTS-generated narration. Books generate N of these — typically
 * one per ~10 pages of source PDF — and the VoiceReader plays them in order
 * while tracking which source page is currently being narrated.
 */
export interface VoiceSegment {
  /** 1-indexed order of this segment within the book. */
  index: number;
  /** Cloudinary URL of the MP3. */
  url: string;
  /** Inclusive source-PDF page range this segment covers. */
  page_start: number;
  page_end: number;
  /** Audio duration in seconds. */
  duration: number;
  /** Character count of the source text (for cost accounting). */
  chars: number;
  /** Per-page paragraph text covered by this segment's audio. Populated
   * during voice generation by re-splitting each page's extracted text on
   * blank lines, then truncating each paragraph to ~320 chars (we only need
   * enough to do substring-matching against the rendered PDF text layer,
   * and full text would bloat the Firestore document past 1 MB on long books).
   * VoiceReader uses this to look up paragraph text by markName from the
   * timepoints below. Optional for backward compatibility — segments
   * generated before this field existed continue to work with page-level
   * (not paragraph-level) highlighting. */
  pages_paragraphs?: Array<{
    page: number;
    paragraphs: string[];
  }>;
  /** EXACT timepoints from Google TTS's SSML <mark> response — one entry per
   * paragraph, giving the precise second in the audio where the TTS engine
   * crosses that mark. Generated during synthesis by embedding `<mark name="pN-K"/>`
   * before each paragraph and requesting `enableTimePointing: ["SSML_MARK"]`
   * on the v1beta1 endpoint. When present, VoiceReader uses these for
   * paragraph-level sync (precise to ~10 ms) instead of estimating from
   * char/word counts. Optional for backward compatibility — segments
   * generated before this field existed fall back to char-weighted
   * approximation, which drifts 5-15 seconds over a long segment. */
  paragraph_timepoints?: Array<{
    /** Format: `p{page}-{paragraphIndex}` e.g. "p47-2" — encodes the source
     * page and paragraph index so we can map back to pages_paragraphs. */
    markName: string;
    /** Seconds offset from the start of this segment's audio. */
    time: number;
  }>;
  /** Voice that generated this segment (Phase 9q). When book.voice_id is
   * changed and differs from this, generate-voice auto-resets so the audio
   * doesn't end up mid-book in two different voices. Undefined on segments
   * generated before 9q — they get treated as the default narrator. */
  voice_id?: string;
}

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
  /** Exact voice-reader restoration fields. current_page is a derived
   * approximation (computed from segment progress) and is good for cross-tab
   * sync, but it's not precise enough to resume audio at the exact pause point
   * — so we also persist the segment we were on plus the seconds within that
   * segment. The VoiceReader seeks the audio element to current_voice_seconds
   * on first metadata-load, restoring the listener to the precise position. */
  current_voice_segment_index?: number;
  current_voice_seconds?: number;

  started_at?: Timestamp;
  last_read_at?: Timestamp;
  finished_at?: Timestamp;

  notes?: string;
  rating?: number;
  highlights?: Highlight[];
}
