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

  // Public sharing (Phase 9t). A single, revocable, unguessable token grants
  // anonymous read access to THIS book only — used for "share a book" links.
  // Admin-only to create. share_enabled gates access independently of the
  // token's existence so a link can be paused without losing the token.
  /** Whether the share link is currently active. When false, /share/<token>
   * returns 404 even if the token is correct. */
  share_enabled?: boolean;
  /** 24-char URL-safe random token. The ONLY credential the public share
   * route and public file proxy accept. Regenerating it invalidates every
   * previously-sent link. */
  share_token?: string;
  /** When the current token was generated. */
  share_created_at?: Timestamp;

  // System
  added_by: string;
  added_at: Timestamp;
  updated_at: Timestamp;
  status: BookStatus;
}

/** Book with its Firestore document ID attached. */
export type Book = BookDoc & { id: string };

/**
 * The strict subset of book data exposed on a public share page (Phase 9t).
 * The public /api/share/[token] route returns ONLY these fields — never the
 * full doc — so internal/admin metadata (added_by, status, voice config,
 * external store links, the share token itself, etc.) never leaks to an
 * anonymous viewer. File URLs are deliberately omitted; the share page loads
 * files through the token-authorized proxy instead of receiving raw
 * Cloudinary URLs.
 */
export interface SharedBook {
  id: string;
  title: string;
  authors?: string[];
  description?: string;
  cover_url?: string;
  page_count?: number;
  /** Which reader tabs to offer — derived server-side from which files exist,
   * so we don't reveal URLs just to decide which tabs to show. */
  has_pdf: boolean;
  has_epub: boolean;
  has_voice: boolean;
  has_audio_summary: boolean;
  /** Voice playback data — needed client-side to drive the VoiceReader. The
   * segment URLs here are already the token-authorized proxy paths, not raw
   * Cloudinary URLs. */
  voice_segments?: VoiceSegment[];
  voice_mode?: "synced" | "premium";
  voice_total_seconds?: number;
  /** Chapter map for the "now reading: chapter X" label + lock-screen
   * metadata. Title + page only — hrefs are harmless but unnecessary. */
  chapter_map?: EpubChapterMapping[];
}

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

// ============================================================
// NOTEBOOK  (Phase 9y — reading notes & highlights)
// ============================================================
//
// A member's notebook for a book is a set of independent `book_notes`
// documents — one per note. A highlight and a note are the SAME entity: a
// Note with an `anchor`. A bare highlight is just a note with a color, a
// captured `quote`, and an empty `body`; "send to notes / add text" only
// fills in the body. This keeps ONE source of truth (cf. paragraphs.ts):
// the reader renders highlight-notes on the page, the notebook lists the
// same notes — never two systems to reconcile.

/** The kind of note. Doubles as the "segment by type" grouping in the
 *  notebook. Catalog metadata (label, color, hint) lives in `notes.ts`. */
export type NoteType =
  | "highlight"
  | "insight"
  | "reflection"
  | "question"
  | "action"
  | "exercise"
  | "vocabulary"
  | "summary"
  | "meditation";

/** Where the note was captured. "manual" = typed straight into the notebook
 *  with no reader selection behind it. */
export type NoteMedium = "pdf" | "epub" | "audio" | "manual";

/** A highlight rectangle in NORMALIZED page coordinates (each value 0..1 of
 *  the PDF page's natural size). Scale-independent, so it redraws correctly at
 *  any zoom. Populated in Phase B (PDF highlighting); null until then. */
export interface NoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Everything needed to (a) group the note under the right chapter/segment,
 * (b) jump back to its exact source, and (c) re-render its highlight. Fields
 * are populated according to the medium — a manual note carries only the
 * chapter; a PDF highlight adds page + rects; an EPUB highlight adds the CFI
 * range; an audio note adds the timestamp.
 */
export interface NoteAnchor {
  medium: NoteMedium;
  /** Index into the book's `epub_chapter_map`; null = front matter / unfiled. */
  chapter_index: number | null;
  /** Denormalized chapter title for display/export without re-deriving. */
  chapter_title: string | null;
  /** Source PDF page (1-indexed). */
  page: number | null;
  /** Paragraph index on that page, per paragraphs.ts. Used for in-book order. */
  paragraph_index: number | null;
  /** EPUB reading location (single point). */
  cfi: string | null;
  /** EPUB highlight range — what epub.js annotates. Phase D. */
  cfi_range: string | null;
  /** Audio position in seconds (within the whole book's narration). Phase C. */
  audio_seconds: number | null;
  /** PDF highlight rectangles, normalized. Phase B. */
  rects: NoteRect[] | null;
}

/** A `book_notes` Firestore document. */
export interface NoteDoc {
  user_id: string;
  book_id: string;
  /** Denormalized `${user_id}_${book_id}`. Lets the notebook load a book's
   *  notes with a SINGLE equality filter — no composite index required. */
  user_book: string;
  type: NoteType;
  /** Highlight color (hex). null = no visual highlight (plain note). */
  color: string | null;
  /** Captured passage. Empty when the note isn't anchored to a quote. */
  quote: string;
  /** The member's own words (Markdown). Empty for a bare highlight. */
  body: string;
  /** Exercise checkbox state. null for non-exercise notes. */
  done: boolean | null;
  /** Favourite / "worth keeping" flag. */
  starred: boolean;
  anchor: NoteAnchor;
  /** Manual ordering within a chapter. Defaults to creation time so new notes
   *  land at the end of their chapter until the member reorders them. */
  order: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** A note with its Firestore document ID attached. */
export type Note = NoteDoc & { id: string };
