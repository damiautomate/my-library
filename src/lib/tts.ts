import "server-only";

/**
 * TTS provider abstraction. We use Google Cloud TTS via the v1beta1 endpoint
 * so we can request SSML `<mark>` timepoints. The timepoints give us EXACT
 * seconds in the synthesized audio for each marked location in the input
 * text, which is what makes our paragraph-level highlighting accurate
 * instead of guessed.
 *
 * The provider interface accepts either plain text (legacy callers) or SSML
 * (when the caller wants mark-based timing). For SSML, you embed
 * `<mark name="..."/>` tags between paragraphs and we'll return one
 * `Timepoint` per mark in the response.
 *
 * Reference: https://cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize
 */

export type TTSProviderId = "google" | "elevenlabs";

export interface Timepoint {
  /** Name from the `<mark name="X"/>` tag in the input SSML. */
  markName: string;
  /** Time offset in seconds from the start of the audio. */
  time: number;
}

export interface SynthesizeInput {
  /** Plain text input. Mutually exclusive with `ssml`. */
  text?: string;
  /** SSML input with optional `<mark>` tags. When provided, the response
   * will include `timepoints` for every mark in the SSML. */
  ssml?: string;
  /** Google TTS voice name override (Phase 9q). Defaults to en-US-Neural2-D
   * when omitted to preserve the pre-9q behavior. Examples:
   *   "en-US-Neural2-F"     → Fiona (synced)
   *   "en-US-Studio-O"      → Olivia (premium, Studio)
   *   "en-US-Chirp3-HD-F"   → Faye (premium, Chirp — text-only) */
  voiceId?: string;
  /** Language code for the voice. Should match the chosen voice's region:
   * "en-US" for Neural2/Studio US voices, "en-GB" for British, etc. Defaults
   * to "en-US". */
  languageCode?: string;
  /** Whether to request SSML mark timepoints. Default true so existing callers
   * keep working. Set false for Studio voices (which reject `<mark>`) and
   * Chirp 3 HD (which rejects SSML entirely). */
  requestTimepoints?: boolean;
}

export interface SynthesizeResult {
  /** Raw MP3 bytes. */
  audio: Buffer;
  /** Duration in seconds (estimated from audio length where the provider
   * doesn't return it directly). */
  duration: number;
  /** Character count actually synthesized — for cost accounting. */
  chars: number;
  /** Timepoints for any `<mark>` tags in the SSML input. Empty array when
   * the input was plain text or contained no marks. */
  timepoints: Timepoint[];
}

export interface TTSProvider {
  id: TTSProviderId;
  /** Maximum characters per single synthesize call. Caller must chunk above
   * this. For SSML this includes the markup, so the practical body length
   * is smaller. */
  maxCharsPerCall: number;
  /** True if this provider supports SSML `<mark>` timepoints. When false,
   * the caller should not bother building SSML — pass plain text instead. */
  supportsTimepoints: boolean;
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}

// ----------------------------------------------------------------------------
// Google Cloud TTS
// ----------------------------------------------------------------------------
//
// We use v1beta1 specifically because it's the only endpoint that supports
// `enableTimePointing: ["SSML_MARK"]`. The v1 endpoint synthesizes fine but
// doesn't return timepoints. v1beta1 has been stable in production use for
// years even though it's labeled "beta".

const GOOGLE_TTS_URL =
  "https://texttospeech.googleapis.com/v1beta1/text:synthesize";

interface GoogleTimepoint {
  markName?: string;
  timeSeconds?: number;
}

interface GoogleTTSResponse {
  audioContent?: string; // base64
  timepoints?: GoogleTimepoint[];
  error?: { message: string };
}

/**
 * Compute the EXACT duration of an MP3 buffer by walking its frame headers.
 *
 * Each MP3 frame self-describes: bitrate, sample rate, padding bit, and
 * (implicitly) sample count. Frame duration = samples_per_frame / sample_rate.
 * Total duration = sum of all frame durations.
 *
 * This replaced the prior estimateMp3DurationByBytes() which assumed a fixed
 * 32 kbps bitrate. That assumption was the cause of paragraph-highlight
 * drift in multi-batch segments: each batch's reported duration was used to
 * offset the NEXT batch's SSML mark timepoints (see generate-voice/route.ts:
 * `time: tp.time + segDuration`), so any error in per-batch duration
 * accumulated across batches. With each batch boundary, the stored timepoints
 * drifted further from real playback position — manifesting as the highlight
 * "freezing" on the last paragraph of one batch while audio played through
 * the next batch, then jumping ahead and being desynced for the rest of the
 * segment. Parsing actual frame headers gives sub-frame precision (~24ms at
 * 24kHz / MPEG-2 Layer 3) regardless of the encoder's bitrate choice.
 *
 * Returns 0 if no valid MP3 frames are found — callers should fall back
 * to estimateMp3DurationByBytes() in that case.
 */
function mp3FrameDuration(buf: Buffer): number {
  // Bitrate tables (kbps). Index 0 = "free format" (unsupported), 15 = invalid.
  const BITRATE_V1_L3 = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1,
  ];
  const BITRATE_V2_L3 = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1,
  ];
  const SR_V1 = [44100, 48000, 32000, 0];
  const SR_V2 = [22050, 24000, 16000, 0];
  const SR_V25 = [11025, 12000, 8000, 0];

  let pos = 0;
  // Skip ID3v2 tag if present (magic "ID3" at offset 0).
  if (
    buf.length >= 10 &&
    buf[0] === 0x49 &&
    buf[1] === 0x44 &&
    buf[2] === 0x33
  ) {
    const sz =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    pos = 10 + sz;
  }

  let duration = 0;
  while (pos + 4 <= buf.length) {
    // Sync = 11 set bits (0xFFE) at the start of the header.
    if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) {
      pos++;
      continue;
    }
    const b1 = buf[pos + 1];
    const b2 = buf[pos + 2];
    const versionBits = (b1 >> 3) & 0x03; // 00=V2.5, 01=reserved, 10=V2, 11=V1
    const layerBits = (b1 >> 1) & 0x03; // 01=L3, 10=L2, 11=L1, 00=reserved
    const bitrateIdx = (b2 >> 4) & 0x0f;
    const srIdx = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    // Only Layer 3 (MP3). Reject reserved/invalid fields.
    if (
      versionBits === 1 ||
      layerBits !== 1 ||
      bitrateIdx === 0 ||
      bitrateIdx === 15 ||
      srIdx === 3
    ) {
      pos++;
      continue;
    }
    const isV1 = versionBits === 3;
    const isV2 = versionBits === 2;
    const bitrateTable = isV1 ? BITRATE_V1_L3 : BITRATE_V2_L3;
    const srTable = isV1 ? SR_V1 : isV2 ? SR_V2 : SR_V25;
    const samplesPerFrame = isV1 ? 1152 : 576;
    const bitrate = bitrateTable[bitrateIdx] * 1000;
    const sr = srTable[srIdx];
    if (!bitrate || !sr) {
      pos++;
      continue;
    }
    // Layer 3 frame size formula:
    //   MPEG-1:        floor(144 * bitrate / sr) + padding
    //   MPEG-2 / 2.5:  floor(72  * bitrate / sr) + padding
    const frameSize = isV1
      ? Math.floor((144 * bitrate) / sr) + padding
      : Math.floor((72 * bitrate) / sr) + padding;
    if (frameSize < 4 || pos + frameSize > buf.length) {
      pos++;
      continue;
    }

    duration += samplesPerFrame / sr;
    pos += frameSize;
  }
  return duration;
}

/**
 * Last-resort fallback when frame parsing returns 0 (buffer isn't a
 * recognizable MP3 stream). Assumes 32 kbps — Google TTS MP3's documented
 * default — but should rarely run, because real MP3 audio always parses.
 */
function estimateMp3DurationByBytes(bytes: number): number {
  const bitrateKbps = 32;
  return bytes / ((bitrateKbps * 1000) / 8);
}

class GoogleProvider implements TTSProvider {
  id: TTSProviderId = "google";
  // Google's hard limit per request is 5000 chars (counts SSML markup too).
  maxCharsPerCall = 4500;
  supportsTimepoints = true;

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GOOGLE_TTS_API_KEY is not set. Create a Google Cloud project, enable the Text-to-Speech API, generate an API key, and add it to Vercel environment variables.",
      );
    }
    if (!input.text && !input.ssml) {
      throw new Error("Must provide either text or ssml");
    }
    if (input.text && input.ssml) {
      throw new Error("Cannot provide both text and ssml — pick one");
    }
    const sourceLen = (input.ssml ?? input.text ?? "").length;
    if (sourceLen > this.maxCharsPerCall) {
      throw new Error(
        `Input too long for one Google TTS call (${sourceLen} chars; max ${this.maxCharsPerCall})`,
      );
    }

    // Build the request body. Voice and timepointing are now caller-driven
    // (Phase 9q) — Neural2/News voices support marks, Studio voices don't,
    // Chirp 3 HD doesn't even accept SSML. Defaults preserve the pre-9q
    // behavior exactly: Neural2-D + timepointing on.
    const voiceName = input.voiceId ?? "en-US-Neural2-D";
    const languageCode = input.languageCode ?? "en-US";
    const requestTimepoints = input.requestTimepoints ?? true;
    const body: Record<string, unknown> = {
      input: input.ssml ? { ssml: input.ssml } : { text: input.text! },
      voice: {
        languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0,
        pitch: 0.0,
      },
    };
    if (requestTimepoints) {
      body.enableTimePointing = ["SSML_MARK"];
    }

    const res = await fetch(`${GOOGLE_TTS_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as GoogleTTSResponse;
    if (!res.ok || !data.audioContent) {
      throw new Error(
        `Google TTS error: ${data.error?.message ?? `HTTP ${res.status}`}`,
      );
    }
    const audio = Buffer.from(data.audioContent, "base64");

    // Convert the raw Google timepoint response to our normalized shape.
    const timepoints: Timepoint[] = (data.timepoints ?? [])
      .filter((t) => typeof t.markName === "string" && typeof t.timeSeconds === "number")
      .map((t) => ({
        markName: t.markName!,
        time: t.timeSeconds!,
      }));

    // CRITICAL: use frame-based duration, not a bitrate guess. The per-batch
    // duration is used as the offset for the NEXT batch's timepoints, so any
    // error compounds across batches. See mp3FrameDuration above for the full
    // story of why a 32 kbps assumption broke paragraph-highlight sync.
    const framed = mp3FrameDuration(audio);
    const duration =
      framed > 0 ? framed : estimateMp3DurationByBytes(audio.length);

    return {
      audio,
      duration,
      chars: sourceLen,
      timepoints,
    };
  }
}

// ----------------------------------------------------------------------------
// ElevenLabs — stubbed
// ----------------------------------------------------------------------------

class ElevenLabsProvider implements TTSProvider {
  id: TTSProviderId = "elevenlabs";
  maxCharsPerCall = 5000;
  // ElevenLabs has its own streaming character-timestamp API but it works
  // differently from SSML marks. Mark support not implemented in this stub.
  supportsTimepoints = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async synthesize(_input: SynthesizeInput): Promise<SynthesizeResult> {
    throw new Error(
      "ElevenLabs provider is not yet implemented. To enable: install the @elevenlabs/elevenlabs-js SDK (or use their REST API), set ELEVENLABS_API_KEY in env, and fill in this synthesize method.",
    );
  }
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

export function getProvider(id: TTSProviderId): TTSProvider {
  switch (id) {
    case "google":
      return new GoogleProvider();
    case "elevenlabs":
      return new ElevenLabsProvider();
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown TTS provider: ${_exhaustive}`);
    }
  }
}

// ----------------------------------------------------------------------------
// SSML building
// ----------------------------------------------------------------------------

/**
 * Escape a string for safe inclusion as SSML text content. SSML is XML, so
 * the usual five entities must be replaced. Anything else (curly quotes,
 * em-dashes, etc.) is fine to leave alone — Google TTS handles them.
 */
function escapeSsmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface ParagraphForSSML {
  /** Identifier embedded in the mark — recovered at playback time to look up
   * which paragraph this timestamp belongs to. Format: `p{page}-{idx}`. */
  markName: string;
  text: string;
}

/**
 * Build an SSML string with a `<mark>` before each paragraph. The marks
 * generate timepoints in the response that we use for precise paragraph-level
 * sync. We follow Google's published guidance:
 *
 *   - One mark per paragraph (NOT consecutive marks)
 *   - Each mark followed by actual speech text (no audio-less gaps)
 *   - A short <break> between paragraphs to give natural pause and prevent
 *     marks from landing in the gap (where they may not fire)
 *
 * Returns the SSML string. Caller is responsible for keeping it under the
 * provider's maxCharsPerCall — caller should chunk paragraphs across calls
 * if needed.
 */
export function buildParagraphSSML(paragraphs: ParagraphForSSML[]): string {
  const parts: string[] = ['<speak>'];
  paragraphs.forEach((p, i) => {
    const txt = p.text.trim();
    if (!txt) return;
    if (i > 0) {
      // Small pause between paragraphs — feels natural and ensures the next
      // mark lands on actual speech, not silence.
      parts.push('<break time="350ms"/>');
    }
    parts.push(`<mark name="${escapeSsmlText(p.markName)}"/>`);
    parts.push(escapeSsmlText(txt));
  });
  parts.push("</speak>");
  return parts.join("");
}

/**
 * Premium-mode SSML — same idea as buildParagraphSSML but WITHOUT marks,
 * for Studio voices which reject `<mark>` (Phase 9q). Paragraph breaks are
 * still expressed via `<break time>` so the listener gets natural pacing.
 * Returns null when the caller should use plain text instead (Chirp 3 HD).
 */
export function buildParagraphSSMLNoMarks(
  paragraphs: ParagraphForSSML[],
): string {
  const parts: string[] = ["<speak>"];
  paragraphs.forEach((p, i) => {
    const txt = p.text.trim();
    if (!txt) return;
    if (i > 0) parts.push('<break time="350ms"/>');
    parts.push(escapeSsmlText(txt));
  });
  parts.push("</speak>");
  return parts.join("");
}

/**
 * Plain-text fallback for Chirp 3 HD voices, which reject SSML entirely.
 * Paragraphs are joined with double-newlines — Chirp's prosody engine seems
 * to honor these as paragraph breaks even without explicit markup.
 */
export function buildParagraphPlainText(
  paragraphs: ParagraphForSSML[],
): string {
  return paragraphs
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

// ----------------------------------------------------------------------------
// Text chunking (kept for backward compatibility / plain-text fallback)
// ----------------------------------------------------------------------------

/**
 * Split text into chunks <= maxChars, breaking only at sentence boundaries.
 * If a single "sentence" exceeds maxChars, we break at the nearest space.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const s of sentences) {
    if (buf.length + s.length + 1 <= maxChars) {
      buf = buf ? `${buf} ${s}` : s;
    } else {
      if (buf) chunks.push(buf);
      if (s.length <= maxChars) {
        buf = s;
      } else {
        let remaining = s;
        while (remaining.length > maxChars) {
          let cut = remaining.lastIndexOf(" ", maxChars);
          if (cut === -1) cut = maxChars;
          chunks.push(remaining.slice(0, cut));
          remaining = remaining.slice(cut).trimStart();
        }
        buf = remaining;
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
