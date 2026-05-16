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
- isbn_13: the canonical 13-digit ISBN if you know it confidently, otherwise omit
- why_this_book: 2–3 sentence curator's note, written in second person directly
  to the reader ("This book gives you ___, especially if ___."). Avoid
  marketing language. Be specific about what changes for the reader.

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
function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
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
    max_tokens: 2000,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      `Anthropic API ${res.status}: ${errBody.slice(0, 300)}`,
    );
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
