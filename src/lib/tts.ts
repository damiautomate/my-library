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
 * Estimate MP3 duration from byte length. Used only as a fallback when the
 * provider doesn't report duration. Our MP3 settings give ~32 kbps:
 *   bytes / (bitrate_kbps * 1000 / 8) = seconds
 * Accurate to ~5%, fine for our purposes.
 */
function estimateMp3Duration(bytes: number): number {
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

    // Build the request body. We always request SSML_MARK timepoints — if
    // the input is plain text or contains no marks, the timepoints array
    // comes back empty, which is fine.
    const body = {
      input: input.ssml ? { ssml: input.ssml } : { text: input.text! },
      voice: {
        languageCode: "en-US",
        // Neural2 is the sweet spot: far better than Standard, much cheaper
        // than Studio, AND supports <mark> tags (Studio doesn't).
        name: "en-US-Neural2-D",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0,
        pitch: 0.0,
      },
      enableTimePointing: ["SSML_MARK"],
    };

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

    return {
      audio,
      duration: estimateMp3Duration(audio.length),
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
 * Escape a string for safe inclusion as SSML text content. SSML is XML, so:
 *   - the standard five entities must be replaced (&, <, >, ", ')
 *   - any character outside XML 1.0's legal range must be REMOVED (escaping
 *     won't make them legal). PDF text extraction occasionally emits stray
 *     control characters (NUL, bell, vertical tab, etc.) from malformed font
 *     mappings, and these would silently truncate the SSML at parse time —
 *     causing Google to drop everything after the bad character without
 *     reporting an error. Stripping them up front prevents that.
 */
function escapeSsmlText(s: string): string {
  return s
    // Strip ASCII control chars except tab (\x09), LF (\x0A), CR (\x0D)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    // Strip the two Unicode non-characters that are explicitly invalid in XML
    .replace(/[\uFFFE\uFFFF]/g, "")
    // Standard XML entity escaping
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
  // The leading <break time="100ms"/> exists because Google's documentation
  // warns: "Use the START and END marks instead of adding custom marks near
  // the beginning or end of the SSML." A custom mark placed at the very start
  // of <speak> can fail to generate a timepoint event — which would mean the
  // first paragraph of every segment becomes "untimed" and the player can't
  // tell when it begins. The 100ms intro silence pushes the first mark off
  // the absolute start, making sure it fires reliably.
  const parts: string[] = ['<speak>', '<break time="100ms"/>'];
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
