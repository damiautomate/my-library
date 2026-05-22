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

export type VoiceTier =
  | "neural2"
  | "news"
  | "wavenet"
  | "studio"
  | "chirp3-hd"
  | "polly-neural"
  | "polly-long-form"
  | "polly-generative";
export type VoiceMode = "synced" | "premium";
export type VoiceGender = "female" | "male";
/** Which TTS provider this voice runs on. Drives which API the
 * generate-voice route calls and which credentials env vars are required. */
export type VoiceProvider = "google" | "aws";

export interface VoiceMeta {
  /** Exact provider voice name. For Google: the canonical Google TTS name
   * ("en-US-Neural2-D"). For AWS Polly: the bare voice name with an engine
   * suffix our adapter strips ("Joanna-Neural", "Danielle-Generative"). */
  id: string;
  /** Friendly first name shown in the UI. */
  displayName: string;
  gender: VoiceGender;
  /** Accent label shown as a small badge — "American", "British", "Australian". */
  accent: string;
  /** Language code passed to the TTS API. Google needs this; Polly infers
   * it from the voice name but we keep the field for UI display. */
  languageCode: string;
  /** One-line tone description shown under the name. */
  description: string;
  /** Voice family — drives provider behavior and cost expectations. */
  tier: VoiceTier;
  /** "synced" supports highlight; "premium" does not. */
  mode: VoiceMode;
  /** TTS backend that serves this voice (Phase 9s). Defaults to "google" on
   * existing entries to preserve backward compat. */
  provider: VoiceProvider;
  /** Tags the AI suggester uses to match voices to books. Examples:
   *  ["faith", "memoir", "warm"], ["business", "authoritative"]. */
  bestFor: string[];
}

/**
 * TTS pricing per million characters as of May 2026. Drives the cost
 * estimate in the regen confirmation modal (Phase 9q.2). Update if/when
 * either provider changes their published pricing.
 *
 * Sources:
 *  - https://cloud.google.com/text-to-speech/pricing
 *  - https://aws.amazon.com/polly/pricing/
 *
 * Each tier has a free monthly quota (Google: 1M chars Neural2/News/Studio,
 * Polly: 5M chars Standard, 1M Neural for 12 months then ~$4/M, generative
 * has no free tier). The modal mentions this in passing but doesn't try to
 * track usage — we don't have visibility into either project's monthly
 * counters, so the estimate shows the FULL price and the user does the
 * mental math.
 */
export const PRICE_PER_MILLION_CHARS_USD: Record<VoiceTier, number> = {
  neural2: 16,
  news: 16,
  wavenet: 16,
  studio: 160,
  "chirp3-hd": 30,
  "polly-neural": 16,
  "polly-long-form": 100,
  "polly-generative": 30,
};

/** Per-tier monthly free-quota character count, for displaying alongside the
 * cost estimate. Same sources as the pricing constants above. */
export const FREE_QUOTA_CHARS_PER_MONTH: Record<VoiceTier, number> = {
  neural2: 1_000_000,
  news: 1_000_000,
  wavenet: 1_000_000,
  studio: 1_000_000,
  "chirp3-hd": 1_000_000,
  "polly-neural": 1_000_000,
  "polly-long-form": 500_000,
  "polly-generative": 100_000,
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
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
    provider: "google",
    bestFor: ["fiction", "biography", "narrative-non-fiction", "premium"],
  },

  // ---- AWS Polly — Neural (synced, same price as Google Neural2) ----
  {
    id: "Joanna-Neural",
    displayName: "Joanna",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description: "Natural conversational female. Polly's flagship voice.",
    tier: "polly-neural",
    mode: "synced",
    provider: "aws",
    bestFor: ["non-fiction", "personal-development", "memoir", "warm"],
  },
  {
    id: "Matthew-Neural",
    displayName: "Matthew",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description: "Confident, casual male. Strong for business and tech writing.",
    tier: "polly-neural",
    mode: "synced",
    provider: "aws",
    bestFor: ["business", "tech", "non-fiction", "career"],
  },
  {
    id: "Ruth-Neural",
    displayName: "Ruth",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description: "Warm, articulate female. Great alternative for memoir and reflection.",
    tier: "polly-neural",
    mode: "synced",
    provider: "aws",
    bestFor: ["memoir", "spirituality", "reflection", "warm"],
  },
  {
    id: "Stephen-Neural",
    displayName: "Stephen",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description: "Calm, measured male. Suits philosophy and instructional books.",
    tier: "polly-neural",
    mode: "synced",
    provider: "aws",
    bestFor: ["philosophy", "instructional", "academic", "calm"],
  },
  {
    id: "Amy-Neural",
    displayName: "Amy",
    gender: "female",
    accent: "British",
    languageCode: "en-GB",
    description: "Refined British female. Polly's literary-quality counterpart to Charlotte.",
    tier: "polly-neural",
    mode: "synced",
    provider: "aws",
    bestFor: ["literature", "memoir", "fiction", "british"],
  },
  {
    id: "Brian-Neural",
    displayName: "Brian",
    gender: "male",
    accent: "British",
    languageCode: "en-GB",
    description: "Distinguished British male. Polly's literary counterpart to Benedict.",
    tier: "polly-neural",
    mode: "synced",
    provider: "aws",
    bestFor: ["literature", "classics", "history", "british"],
  },

  // ---- AWS Polly — Generative (premium, no highlight) ----
  {
    id: "Danielle-Generative",
    displayName: "Danielle",
    gender: "female",
    accent: "American",
    languageCode: "en-US",
    description:
      "Generative voice — lifelike female with emotional nuance. No live highlight.",
    tier: "polly-generative",
    mode: "premium",
    provider: "aws",
    bestFor: ["fiction", "narrative-non-fiction", "memoir", "premium"],
  },
  {
    id: "Matthew-Generative",
    displayName: "Matthew (Gen)",
    gender: "male",
    accent: "American",
    languageCode: "en-US",
    description:
      "Generative voice — lifelike male, expressive range. No live highlight.",
    tier: "polly-generative",
    mode: "premium",
    provider: "aws",
    bestFor: ["fiction", "biography", "modern", "premium"],
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
