import "server-only";
import {
  LIFE_DOMAINS,
  LIFE_STAGES,
  ROOMS,
  READER_LEVELS,
  READING_MODES,
  CULTURAL_CONTEXTS,
  OUTCOME_SUGGESTIONS,
  FIELD_SUGGESTIONS,
  LANGUAGES,
} from "./taxonomy";

const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface ClassifyInput {
  title: string;
  author?: string;
  /** First-pages text extracted from the uploaded PDF, if any. */
  pdfText?: string;
}

export interface ClassifiedBook {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publication_year?: number;
  page_count?: number;
  language?: string;
  isbn_13?: string;
  isbn_10?: string;
  life_domains?: string[];
  life_stages?: string[];
  rooms?: string[];
  reader_level?: string;
  reading_modes?: string[];
  cultural_contexts?: string[];
  outcomes?: string[];
  fields?: string[];
  why_this_book?: string;
}

/**
 * Build the system prompt with the full taxonomy embedded so the model uses
 * exact enum keys.
 */
function buildSystemPrompt(): string {
  const domains = Object.entries(LIFE_DOMAINS)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const stages = Object.entries(LIFE_STAGES)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const rooms = (
    Object.entries(ROOMS) as [string, { label: string; desc: string }][]
  )
    .map(([k, v]) => `  - ${k}: ${v.label} — ${v.desc}`)
    .join("\n");
  const levels = Object.entries(READER_LEVELS)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const modes = Object.entries(READING_MODES)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const contexts = Object.entries(CULTURAL_CONTEXTS)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const langs = Object.entries(LANGUAGES)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  return `You are the curator of a small, deliberate, invite-only digital library.
Your job is to classify and describe a single book so the library's reader-
oriented architecture can shelve it correctly.

The library organises books across multiple dimensions. For each classification
field below, you MUST use ONLY the exact keys listed. Do not invent new keys.

# life_domains (multi-select, pick the 1–4 that the book is most about)
${domains}

# life_stages (multi-select, pick the 1–3 stages where the book is most useful)
${stages}

# rooms (multi-select; almost always 1, occasionally 2)
${rooms}

# reader_level (exactly one)
${levels}

# reading_modes (multi-select, pick the 1–3 best ways to read this book)
${modes}

# cultural_contexts (multi-select)
${contexts}

# outcomes (free-form snake_case, pick 2–6)
A reader's likely outcome from finishing the book. Use lowercase snake_case.
Common values include: ${OUTCOME_SUGGESTIONS.join(", ")}.
You may coin new outcomes sparingly when none of the above fit.

# fields (free-form snake_case, pick 1–3)
Career or interest path most likely to benefit. Common values include:
${FIELD_SUGGESTIONS.join(", ")}.

# language (one ISO key)
${langs}

# Other fields
- title: canonical title in Title Case
- subtitle: subtitle if present, otherwise omit
- authors: array of full author names
- description: 2–4 sentence summary that respects the book's actual content
- publisher, publication_year, page_count: best-known values
- isbn_13: the 13-digit ISBN of the most common edition you know of. ISBN is
  hard to remember exactly, but a near-correct guess is FAR more useful than
  no guess at all — we run additional validation downstream and discard wrong
  ones. So please make a confident attempt for any reasonably well-known book.
  Omit only if you genuinely have no idea what edition this would be.

# why_this_book — the most important field

This is a curator's personal note to the reader, NOT a summary. The description
field above is the summary. This field answers a different question:

  "Why should I spend my finite time reading THIS book?"

Write 4–6 sentences in second person, conversational and direct, like a
thoughtful friend telling you why you should read something. Be specific about
who needs this book now, and what shifts in them after reading it. What
worldview gets challenged? What permission or framework gets unlocked? What
dangerous comfort gets disturbed?

DO NOT:
  - Summarize the book's content (that's what description is for)
  - Use marketing language like "must-read", "life-changing", "transformative"
  - Use phrases like "essential reading", "ground-breaking", "powerful"
  - Open with the book's name or the author's name
  - Open with "This book..." (overused, lazy)

DO:
  - Speak to a specific stakes-laden situation the reader might be in
  - Name the actual shift the book produces in your thinking
  - Be willing to be slightly opinionated — curators have taste
  - Sound like a person talking, not a press release

Examples of the tone we want:

  - "Most habit books treat you like a project to optimize. Clear treats you
    like a person who's already trying their best with bad maps. The reframe —
    that you don't rise to your goals, you fall to your systems — is one of
    those ideas that gets quieter and more useful the longer you sit with it.
    Read it when productivity advice has started to feel like its own kind of
    procrastination."

  - "Read this when you've been busy without being productive for so long
    that you've stopped trusting the difference. Newport gives you a way to
    feel that difference again — not in your calendar but in your nervous
    system. The chapter on Roosevelt dashes alone is worth the price."

  - "The book to give your younger self who thinks success is a math problem.
    Covey's habits aren't tactics; they're the kind of foundational moves
    that make everything else you'll learn either work or not work. The
    'sharpen the saw' principle has saved me from at least three burnouts."

# Output format

Return ONLY a single JSON object. No prose before or after, no markdown fences.
If you are uncertain about a specific field, OMIT it rather than guessing.
Better to leave a field empty than to invent a wrong value.`;
}

function buildUserPrompt(input: ClassifyInput): string {
  const parts: string[] = [];
  parts.push(`Title: ${input.title}`);
  if (input.author) parts.push(`Author (hint): ${input.author}`);
  if (input.pdfText) {
    parts.push("");
    parts.push("First pages of the book:");
    parts.push("```");
    parts.push(input.pdfText);
    parts.push("```");
  } else {
    parts.push("");
    parts.push(
      "No file content provided. Classify based on your knowledge of this book.",
    );
    parts.push(
      "If you are not confident this book exists or you don't know it,",
    );
    parts.push(
      "return a JSON object with only the title filled — leave classification empty.",
    );
  }
  parts.push("");
  parts.push("Return the JSON object now.");
  return parts.join("\n");
}

/** Strip a leading ```json / trailing ``` if the model added them. */
export function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/**
 * Call Anthropic with retry-on-429 (rate limit) using exponential backoff.
 * Tier 1 accounts have ~5 RPM on Sonnet — bulk imports of 10+ books hit this
 * routinely. We retry up to 5 times with backoff before giving up, which gets
 * a ~1-minute book through reliably.
 */
export async function callAnthropic(
  body: object,
  apiKey: string,
): Promise<Response> {
  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (res.status !== 429 && res.status !== 529) return res;

    // 429 (rate limit) or 529 (overloaded) — back off and retry.
    lastErr = await res.text().catch(() => "");
    // Prefer the server's hint if present, else exponential backoff capped at 30s.
    const retryAfter = Number(res.headers.get("retry-after"));
    const fallback = Math.min(2 ** attempt * 1000 + Math.random() * 1000, 30_000);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : fallback;
    console.warn(
      `[anthropic] ${res.status} on attempt ${attempt + 1}, waiting ${Math.round(waitMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error(`Anthropic rate-limited after 5 attempts. Last body: ${lastErr.slice(0, 200)}`);
}

/**
 * Call Anthropic with a tight system prompt and a JSON-only user message.
 * Returns the parsed JSON object or throws on failure.
 */
export async function classifyBook(
  input: ClassifyInput,
): Promise<ClassifiedBook> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to Vercel environment variables.",
    );
  }

  const body = {
    model: MODEL,
    max_tokens: 3000,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  };

  const res = await callAnthropic(body, apiKey);

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };

  const textBlock = data.content?.find((c) => c.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic returned no text content");
  }

  const cleaned = stripFences(textBlock.text);
  try {
    return JSON.parse(cleaned) as ClassifiedBook;
  } catch (err) {
    throw new Error(
      `Anthropic returned non-JSON text: ${cleaned.slice(0, 200)}…`,
    );
  }
}
