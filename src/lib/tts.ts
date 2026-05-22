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

export type TTSProviderId = "google" | "aws" | "elevenlabs";

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
// AWS Polly (Phase 9s)
// ----------------------------------------------------------------------------
//
// Polly is our alternative provider — useful when Google has an outage, when
// the project hits a Google quota wall, or when a specific Polly voice fits
// a book better than any Google option. Existing books on Google keep working
// untouched: the route picks the provider from the selected voice's catalog
// entry, so swapping providers is a per-book voice choice.
//
// Differences from Google's API to be aware of:
//
//  1. Polly's mark timepoints come from a SEPARATE call. Google returns audio
//     and timepoints in one response; Polly requires two synthesizeSpeech
//     calls per batch — one with OutputFormat="mp3", one with
//     OutputFormat="json" + SpeechMarkTypes=["ssml"]. The cost is 2x calls
//     per batch (small absolute cost — calls are fast) but you pay for the
//     synthesis characters only once.
//
//  2. Polly returns mark times in MILLISECONDS; we normalize to seconds to
//     match the SynthesizeResult contract.
//
//  3. Polly's neural engine supports SSML including <mark>, <emphasis>,
//     <break>, <s>, and <say-as>. Generative & long-form voices don't
//     support marks — those map to "premium" mode in our catalog.

class AwsPollyProvider implements TTSProvider {
  id: TTSProviderId = "aws";
  // Polly's per-request character cap is tighter than Google's. Per the
  // AWS Polly SynthesizeSpeech docs:
  //
  //   - Neural engine: 3,000 total characters (text + SSML markup)
  //   - Generative engine: 2,000 characters (plain text — no SSML accepted)
  //   - Long-form engine: 3,000 total (same as Neural)
  //
  // We use 2,000 here as a single value that's safe across ALL Polly
  // engines we expose. Generative's 2,000-char ceiling is the binding
  // constraint; Neural just runs at lower utilization. The route's batcher
  // packs paragraphs up to this size, then sends each batch as one
  // synthesizeSpeech call. ~33% more batches than Google means slightly
  // more API roundtrips per segment, but the cross-batch timing is safe
  // thanks to the mp3FrameDuration parser from Phase 9n.
  maxCharsPerCall = 2000;
  supportsTimepoints = true;

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    // Lazy import so the AWS SDK only loads when someone actually uses it.
    // The SDK is ~5MB unzipped — keeping it out of the Google-only hot path
    // matters for serverless cold starts on routes that never touch AWS.
    const { PollyClient, SynthesizeSpeechCommand } = await import(
      "@aws-sdk/client-polly"
    );
    type PollyVoiceId = NonNullable<
      ConstructorParameters<typeof SynthesizeSpeechCommand>[0]["VoiceId"]
    >;

    const region = process.env.AWS_REGION ?? "us-east-1";
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set. Add them to Vercel environment variables, then redeploy.",
      );
    }

    const client = new PollyClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    const voiceName = input.voiceId ?? "Joanna";
    const requestTimepoints = input.requestTimepoints ?? true;

    // Polly uses a per-voice engine flag rather than encoding the engine in
    // the voice name like Google does. Default to "neural" — our catalog
    // entries override with "generative" / "long-form" when needed via
    // a separate field passed from the route. For now we infer from the
    // voice name's suffix convention used in voices.ts.
    const engine = inferPollyEngine(voiceName);

    const inputType: "text" | "ssml" = input.ssml ? "ssml" : "text";
    const inputContent = input.ssml ?? input.text ?? "";
    const sourceLen = inputContent.length;

    // --- Audio call ---
    const audioCmd = new SynthesizeSpeechCommand({
      Text: inputContent,
      TextType: inputType,
      OutputFormat: "mp3",
      VoiceId: stripPollyEngineSuffix(voiceName) as PollyVoiceId,
      Engine: engine,
      // Polly chooses sample rate automatically per engine; explicit override
      // not needed for our use case.
    });
    const audioResp = await client.send(audioCmd);
    if (!audioResp.AudioStream) {
      throw new Error("Polly returned no audio stream");
    }
    const audio = await streamToBuffer(audioResp.AudioStream);

    // --- Timepoint call (only when requested AND engine supports marks) ---
    let timepoints: Timepoint[] = [];
    if (requestTimepoints && engine !== "generative" && input.ssml) {
      const marksCmd = new SynthesizeSpeechCommand({
        Text: inputContent,
        TextType: inputType,
        OutputFormat: "json",
        SpeechMarkTypes: ["ssml"],
        VoiceId: stripPollyEngineSuffix(voiceName) as PollyVoiceId,
        Engine: engine,
      });
      const marksResp = await client.send(marksCmd);
      if (marksResp.AudioStream) {
        const marksRaw = await streamToString(marksResp.AudioStream);
        // Polly returns JSON-lines: one JSON object per line. Filter to ssml
        // marks (we set SpeechMarkTypes to ssml only, but be defensive).
        timepoints = marksRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as {
                time: number;
                type: string;
                value: string;
              };
            } catch {
              return null;
            }
          })
          .filter(
            (m): m is { time: number; type: string; value: string } =>
              m !== null && m.type === "ssml",
          )
          .map((m) => ({
            markName: m.value,
            // Polly returns ms; the SynthesizeResult contract is seconds.
            time: m.time / 1000,
          }));
      }
    }

    // Duration via the same frame parser we use for Google. Polly's MP3
    // output is also CBR / consistent enough that frame-walking gives
    // accurate per-batch durations — critical for the cross-batch offset
    // bookkeeping in generate-voice (see Phase 9n background).
    const framed = mp3FrameDuration(audio);
    const duration = framed > 0 ? framed : estimateMp3DurationByBytes(audio.length);

    return {
      audio,
      duration,
      chars: sourceLen,
      timepoints,
    };
  }
}

/**
 * Polly's engine parameter ("standard" / "neural" / "long-form" / "generative")
 * is independent of the voice name in the AWS API. Our catalog encodes the
 * engine in the voice ID using suffixes like "Joanna-Neural" or
 * "Danielle-Generative" so we can keep one flat `voice_id` field on the book
 * doc. This helper extracts the engine from that suffix.
 *
 * Unsuffixed voice IDs default to neural (the modern default and what most
 * Polly users want).
 */
function inferPollyEngine(
  voiceName: string,
): "standard" | "neural" | "long-form" | "generative" {
  const v = voiceName.toLowerCase();
  if (v.endsWith("-generative")) return "generative";
  if (v.endsWith("-long-form")) return "long-form";
  if (v.endsWith("-standard")) return "standard";
  return "neural";
}

/** Strip the engine suffix added by our catalog convention before sending to
 * the Polly API, which expects bare voice names ("Joanna", not "Joanna-Neural"). */
function stripPollyEngineSuffix(voiceName: string): string {
  return voiceName.replace(/-(generative|long-form|standard|neural)$/i, "");
}

/** Convert a Polly AudioStream (which is an SDK stream type) to a Buffer.
 * Works with both the modern stream interface and the legacy uint8array
 * fallback path some runtimes use. */
async function streamToBuffer(stream: unknown): Promise<Buffer> {
  // AWS SDK v3 streams expose .transformToByteArray() in Node 18+.
  if (
    typeof stream === "object" &&
    stream !== null &&
    "transformToByteArray" in stream &&
    typeof (stream as { transformToByteArray: () => Promise<Uint8Array> })
      .transformToByteArray === "function"
  ) {
    const bytes = await (
      stream as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }
  // Fallback: iterate as async iterable (Node Readable stream)
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Convert a Polly AudioStream to a UTF-8 string — used for the JSON-lines
 * mark response. */
async function streamToString(stream: unknown): Promise<string> {
  const buf = await streamToBuffer(stream);
  return buf.toString("utf-8");
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
    case "aws":
      return new AwsPollyProvider();
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
 * Detect whether a paragraph looks like a heading.
 *
 * Combined heuristic with three independent signals — any one triggers:
 *   1. Starts with a structural keyword (chapter/part/section/etc) and
 *      doesn't end with sentence-ending punctuation. Catches "Chapter 5",
 *      "Part Two: The Reckoning", "Introduction" etc.
 *   2. All-caps multi-word phrase. Catches "WHY WE FAIL" / "THE BEGINNING".
 *      Single-word all-caps is excluded — too often stylistic emphasis
 *      ("NEVER give up") rather than a true heading.
 *   3. Short (<= 80 chars), starts with a capital letter, doesn't end with
 *      sentence-ending punctuation. Catches subheadings like "Why now".
 *
 * Length cap at 120 chars rules out actual sentences that happen to lack a
 * period (extraction artifacts on the last line of a page, etc.).
 *
 * Trade-off chosen: false positives are mostly harmless — adding mild
 * emphasis + a longer pause to a body paragraph sounds slightly more
 * deliberate, not wrong. False negatives leave headings flat. So we err
 * on the side of detecting more rather than less.
 */
function looksLikeHeading(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  const endsWithSentence = /[.!?;:,]$/.test(t);

  // Signal 1: structural keyword
  if (
    /^(chapter|part|section|appendix|book|prologue|epilogue|introduction|conclusion|preface|foreword|afterword)\b/i.test(
      t,
    ) &&
    !endsWithSentence
  ) {
    return true;
  }

  // Signal 2: all-caps multi-word
  // Allow letters, apostrophes, hyphens, ampersands, digits, spaces.
  // Require 2+ words and first+last char to be uppercase letters.
  if (
    /^[A-Z][A-Z0-9'\-&\s]+[A-Z0-9]$/.test(t) &&
    t.split(/\s+/).length >= 2
  ) {
    return true;
  }

  // Signal 3: short, capital-led, not a sentence
  if (t.length <= 80 && !endsWithSentence && /^[A-Z]/.test(t)) {
    return true;
  }

  return false;
}

/**
 * Split a paragraph into sentences for `<s>` wrapping. Sentence boundary
 * is "punctuation followed by whitespace and a capital letter", which is
 * good enough for prose. Doesn't try to handle abbreviations ("Dr. Smith"
 * would over-split) — Google's voices are tolerant of an extra <s>, and
 * the prosody gain on correctly-split sentences outweighs the rare
 * over-split.
 */
function splitIntoSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z"'])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * Build an SSML string with a `<mark>` before each paragraph (Phase 9s
 * upgrade — heading-aware prosody and sentence wrapping). The marks
 * generate timepoints in the response that we use for precise
 * paragraph-level sync. We follow Google's published guidance:
 *
 *   - One mark per paragraph (NOT consecutive marks)
 *   - Each mark followed by actual speech text (no audio-less gaps)
 *   - A short <break> between paragraphs to give natural pause and prevent
 *     marks from landing in the gap (where they may not fire)
 *
 * Heading paragraphs get extra treatment: a longer pre-break (600ms instead
 * of 350ms), wrapping in `<emphasis level="moderate">`, and a longer
 * post-break (500ms after) — so chapter headings sound like proper
 * announcements rather than just a louder body line.
 *
 * Body paragraphs are split into sentences and wrapped in `<s>` tags, which
 * Google's docs recommend for better intonation and pacing across long
 * paragraphs. Short single-sentence paragraphs skip the wrapping (it would
 * be redundant noise in the SSML).
 *
 * Returns the SSML string. Caller is responsible for keeping it under the
 * provider's maxCharsPerCall — caller should chunk paragraphs across calls
 * if needed.
 */
export function buildParagraphSSML(paragraphs: ParagraphForSSML[]): string {
  const parts: string[] = ["<speak>"];
  paragraphs.forEach((p, i) => {
    const txt = p.text.trim();
    if (!txt) return;
    const isHeading = looksLikeHeading(txt);

    // Inter-paragraph break. Headings get a longer pre-break so they feel
    // set apart from preceding body text.
    if (i > 0) {
      parts.push(isHeading ? '<break time="600ms"/>' : '<break time="350ms"/>');
    }

    parts.push(`<mark name="${escapeSsmlText(p.markName)}"/>`);

    if (isHeading) {
      // Headings: emphasis wrapper + post-break. Don't bother with sentence
      // splitting — headings are short and benefit more from the unified
      // emphasis envelope than from sentence-by-sentence prosody.
      parts.push(
        `<emphasis level="moderate">${escapeSsmlText(txt)}</emphasis>`,
      );
      parts.push('<break time="500ms"/>');
    } else {
      // Body paragraphs: wrap sentences in <s> when there are 2+ of them.
      // Single-sentence paragraphs skip the wrap (it's redundant — the
      // surrounding <break> tags already mark the boundary).
      const sentences = splitIntoSentences(txt);
      if (sentences.length >= 2) {
        for (const s of sentences) {
          parts.push(`<s>${escapeSsmlText(s)}</s>`);
        }
      } else {
        parts.push(escapeSsmlText(txt));
      }
    }
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
