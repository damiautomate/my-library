/**
 * Voice catalog for the TTS narrator picker (Phase 9q).
 *
 * Two modes of operation:
 *
 *   - "synced" voices (Neural2, News, WaveNet) support SSML `<mark>` tags and
 *     therefore paragraph-level highlight sync. This is the default mode and
 *     what every existing book uses. Quality is good; cost is $16/1M chars.
 *
 *   - "premium" voices (Studio, Chirp 3 HD) sound noticeably more natural —
 *     emotional inflection, breath sounds, human pacing — but reject `<mark>`
 *     (Studio) or all SSML (Chirp). Books using premium voices play as
 *     audio-only, no live paragraph highlight. Cost is $30/1M (Chirp) or
 *     $160/1M (Studio).
 *
 * The narrator picker UI surfaces both groups separately and warns the user
 * that picking a premium voice trades sync for naturalness. The "Let AI pick"
 * flow can choose from either tier — see src/app/api/books/[bookId]/suggest-voice.
 *
 * Adding a voice: append to VOICE_CATALOG with a unique `id` matching Google's
 * voice name exactly (https://cloud.google.com/text-to-speech/docs/list-voices).
 * The `tier` and `mode` fields drive the SSML build path in tts.ts.
 */

export type VoiceTier = "neural2" | "news" | "wavenet" | "studio" | "chirp3-hd";
export type VoiceMode = "synced" | "premium";
export type VoiceGender = "female" | "male";

export interface VoiceMeta {
  /** Exact Google TTS voice name. */
  id: string;
  /** Friendly first name shown in the UI. */
  displayName: string;
  gender: VoiceGender;
  /** Accent label shown as a small badge — "American", "British", "Australian". */
  accent: string;
  /** Language code passed to Google TTS (e.g. "en-US", "en-GB", "en-AU"). */
  languageCode: string;
  /** One-line tone description shown under the name. */
  description: string;
  /** Voice family — drives provider behavior and cost expectations. */
  tier: VoiceTier;
  /** "synced" supports highlight; "premium" does not. */
  mode: VoiceMode;
  /** Tags the AI suggester uses to match voices to books. Examples:
   *  ["faith", "memoir", "warm"], ["business", "authoritative"]. */
  bestFor: string[];
}

/**
 * Google Cloud TTS pricing per million characters as of May 2026. Drives
 * the cost estimate in the regen confirmation modal (Phase 9q.2). Update
 * if/when Google changes their published pricing.
 *
 * Source: https://cloud.google.com/text-to-speech/pricing
 *
 * Each tier has a free monthly quota (1M chars for Neural2/News/Studio,
 * 4M for Standard, 1M for Chirp 3 HD). The modal mentions this in passing
 * but doesn't try to track usage — we don't have visibility into the
 * project's monthly counters, so the cost estimate shows the FULL price
 * and the user can subtract the free tier mentally.
 */
export const PRICE_PER_MILLION_CHARS_USD: Record<VoiceTier, number> = {
  neural2: 16,
  news: 16,
  wavenet: 16,
  studio: 160,
  "chirp3-hd": 30,
};

/** Per-tier monthly free-quota character count, for displaying alongside the
 * cost estimate. Same source as the pricing constants above. */
export const FREE_QUOTA_CHARS_PER_MONTH: Record<VoiceTier, number> = {
  neural2: 1_000_000,
  news: 1_000_000,
  wavenet: 1_000_000,
  studio: 1_000_000,
  "chirp3-hd": 1_000_000,
};

/**
 * Curated narrator list. Twelve voices is the sweet spot — enough variety to
 * fit any book, few enough that the UI doesn't feel like a phone book. All
 * IDs verified against Google's voice list as of May 2026.
 */
export const VOICE_CATALOG: VoiceMeta[] = [
  // ---- Synced (Neural2 / News — SSML mark timepoints work) ----
  {
    id: "en-US-Neural2-D",
    displayName: "David",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description: "Warm, conversational. The friendly default for most non-fiction.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["non-fiction", "personal-development", "memoir", "general"],
  },
  {
    id: "en-US-Neural2-J",
    displayName: "James",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description: "Deep, measured. Suits business, philosophy, and weighty subjects.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["business", "finance", "philosophy", "history", "authoritative"],
  },
  {
    id: "en-US-Neural2-A",
    displayName: "Aaron",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description: "Calm, contemplative. Good for reflective and instructional writing.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["spirituality", "instructional", "academic", "calm"],
  },
  {
    id: "en-US-Neural2-F",
    displayName: "Fiona",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description: "Warm, gentle. A natural fit for devotional and reflective books.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["faith", "spirituality", "memoir", "self-help", "warm"],
  },
  {
    id: "en-US-Neural2-H",
    displayName: "Hannah",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description: "Clear and articulate. Fits academic, career, and how-to books.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["academic", "career", "instructional", "how-to"],
  },
  {
    id: "en-US-Neural2-C",
    displayName: "Claire",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description: "Neutral, professional. The all-purpose female counterpart to David.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["non-fiction", "general", "neutral"],
  },
  {
    id: "en-US-News-N",
    displayName: "Nathan",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description: "Authoritative broadcast tone. Strong for current affairs and journalism.",
    tier: "news",
    mode: "synced",
    bestFor: ["current-affairs", "biography", "investigative", "non-fiction"],
  },
  {
    id: "en-US-News-K",
    displayName: "Katherine",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description: "Polished broadcast delivery. Suits non-fiction with a journalistic feel.",
    tier: "news",
    mode: "synced",
    bestFor: ["non-fiction", "biography", "current-affairs"],
  },
  {
    id: "en-GB-Neural2-B",
    displayName: "Benedict",
    gender: "male",
    accent: "British",
    languageCode: "en-GB",
    description: "Refined British male. Lends gravitas to literature and classics.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["literature", "classics", "history", "british"],
  },
  {
    id: "en-GB-Neural2-C",
    displayName: "Charlotte",
    gender: "female",
    accent: "British",
    languageCode: "en-GB",
    description: "Articulate British female. Fits literary memoir and thoughtful fiction.",
    tier: "neural2",
    mode: "synced",
    bestFor: ["literature", "memoir", "fiction", "british"],
  },

  // ---- Premium (Studio / Chirp 3 HD — no highlight sync) ----
  {
    id: "en-US-Studio-O",
    displayName: "Olivia",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description:
      "Studio-grade narrator. Google's reference voice for audiobook quality. No live highlight.",
    tier: "studio",
    mode: "premium",
    bestFor: ["fiction", "literary", "premium", "narrative-non-fiction"],
  },
  {
    id: "en-US-Studio-Q",
    displayName: "Quincy",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description:
      "Studio-grade narrator male. Cinematic delivery for narrative fiction. No live highlight.",
    tier: "studio",
    mode: "premium",
    bestFor: ["fiction", "biography", "narrative-non-fiction", "premium"],
  },
];

/** Voice used when a book has no explicit narrator chosen. Stable so existing
 * books regenerate to the same voice they previously had. */
export const DEFAULT_VOICE_ID = "en-US-Neural2-D";

export function getVoiceById(id: string | undefined): VoiceMeta {
  if (!id) return VOICE_CATALOG[0];
  const found = VOICE_CATALOG.find((v) => v.id === id);
  // Tolerate stale voice IDs (e.g. an admin selected a voice we later removed
  // from the catalog) by falling back to the default rather than erroring.
  return found ?? VOICE_CATALOG[0];
}

export function getVoicesByMode(mode: VoiceMode): VoiceMeta[] {
  return VOICE_CATALOG.filter((v) => v.mode === mode);
}

/** Public-display shape — what we send to the client and to the AI suggester.
 * Excludes nothing right now but gives us one place to redact if we ever add
 * internal-only fields. */
export function publicVoiceMeta(v: VoiceMeta): VoiceMeta {
  return v;
}

// ----------------------------------------------------------------------------
// Cost estimation (Phase 9q.2 — billing-aware regen confirmation)
// ----------------------------------------------------------------------------

/**
 * Estimated USD cost of synthesizing `chars` characters with the given voice.
 * Pre-free-tier — does NOT subtract any monthly free quota, because we can't
 * see the project's usage counter from this side. The caller's UI separately
 * mentions the free tier so the user can do the mental math.
 */
export function estimateCostUSD(chars: number, voice: VoiceMeta): number {
  if (chars <= 0) return 0;
  const ratePerMillion = PRICE_PER_MILLION_CHARS_USD[voice.tier];
  return (chars / 1_000_000) * ratePerMillion;
}

/** Format a USD amount for casual display. Whole dollars over $1, two
 * decimals between $0.01-$1.00, and "<$0.01" for anything smaller. */
export function formatUSD(amount: number): string {
  if (amount <= 0) return "$0";
  if (amount < 0.01) return "<$0.01";
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 10) return `$${amount.toFixed(2)}`;
  if (amount < 100) return `$${amount.toFixed(0)}`;
  return `$${Math.round(amount).toLocaleString()}`;
}

/** Format a character count compactly: 1,250,000 -> "1.3M", 4,200 -> "4.2K". */
export function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}M`;
  if (chars >= 10_000) return `${Math.round(chars / 1_000)}K`;
  if (chars >= 1_000) return `${(chars / 1_000).toFixed(1)}K`;
  return `${chars}`;
}
