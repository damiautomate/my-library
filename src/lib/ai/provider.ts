import "server-only";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Which vendor serves the AI features. Keys are read from environment
 * variables only — never from Firestore, so an admin who can flip the
 * provider still can't read the credentials.
 */
export type AiProvider = "anthropic" | "openai";

/**
 * "smart" is the book classifier: a long taxonomy prompt returning a large
 * JSON object, where quality matters. "fast" is the narrator suggester: a
 * short prompt returning two fields, where latency and cost matter more.
 */
export type ModelTier = "smart" | "fast";

export interface AiSettings {
  provider: AiProvider;
  anthropicSmartModel: string;
  anthropicFastModel: string;
  openaiSmartModel: string;
  openaiFastModel: string;
}

/**
 * Anthropic defaults preserve exactly what the routes used before this
 * became switchable, so flipping to OpenAI and back is a no-op. All four are
 * editable from /admin/ai, which matters because model availability differs
 * per account and changing one shouldn't need a redeploy.
 */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "anthropic",
  anthropicSmartModel: "claude-sonnet-4-6",
  anthropicFastModel: "claude-haiku-4-5-20251001",
  openaiSmartModel: "gpt-4o",
  openaiFastModel: "gpt-4o-mini",
};

const SETTINGS_DOC = "settings/ai";

/** Read the saved provider settings, falling back to defaults per field. */
export async function getAiSettings(): Promise<AiSettings> {
  try {
    const snap = await adminDb.doc(SETTINGS_DOC).get();
    if (!snap.exists) return DEFAULT_AI_SETTINGS;
    const d = snap.data() ?? {};

    const provider: AiProvider =
      d.provider === "openai" ? "openai" : "anthropic";

    const str = (v: unknown, fallback: string) =>
      typeof v === "string" && v.trim() ? v.trim() : fallback;

    return {
      provider,
      anthropicSmartModel: str(
        d.anthropic_smart_model,
        DEFAULT_AI_SETTINGS.anthropicSmartModel,
      ),
      anthropicFastModel: str(
        d.anthropic_fast_model,
        DEFAULT_AI_SETTINGS.anthropicFastModel,
      ),
      openaiSmartModel: str(
        d.openai_smart_model,
        DEFAULT_AI_SETTINGS.openaiSmartModel,
      ),
      openaiFastModel: str(
        d.openai_fast_model,
        DEFAULT_AI_SETTINGS.openaiFastModel,
      ),
    };
  } catch (err) {
    // A settings read failure must not take the AI features down — the
    // previous behaviour (Anthropic, fixed models) is a safe fallback.
    console.warn("[ai] could not read settings, using defaults", err);
    return DEFAULT_AI_SETTINGS;
  }
}

/** Which providers have a key present. Never returns the keys themselves. */
export function configuredProviders(): Record<AiProvider, boolean> {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
  };
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Statuses worth retrying: rate limit, overloaded, and transient 5xx. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

/**
 * POST with retry-on-rate-limit using exponential backoff.
 *
 * Anthropic Tier 1 allows ~5 requests/minute, which a bulk import of 10+
 * books hits routinely; OpenAI's free-tier limits are comparable. Five
 * attempts with backoff gets a slow book through rather than failing the
 * whole import.
 */
async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: object,
  label: string,
): Promise<Response> {
  let lastErr = "";

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

    if (!isRetryable(res.status)) return res;

    lastErr = await res.text().catch(() => "");
    const retryAfter = Number(res.headers.get("retry-after"));
    const fallback = Math.min(
      2 ** attempt * 1000 + Math.random() * 1000,
      30_000,
    );
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : fallback;

    console.warn(
      `[${label}] ${res.status} on attempt ${attempt + 1}, waiting ${Math.round(waitMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }

  throw new Error(
    `${label} rate-limited after 5 attempts. Last body: ${lastErr.slice(0, 200)}`,
  );
}

/** Strip a leading ```json / trailing ``` if the model added them. */
export function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function keyFor(provider: AiProvider): string {
  const key =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;

  if (!key) {
    const envName =
      provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    throw new Error(
      `${envName} is not set, but ${provider} is the selected AI provider. ` +
        `Add it to your Vercel environment variables, or switch provider at /admin/ai.`,
    );
  }
  return key;
}

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const res = await postWithRetry(
    ANTHROPIC_URL,
    {
      "x-api-key": keyFor("anthropic"),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    },
    "anthropic",
  );

  if (!res.ok) {
    throw new Error(
      `Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic returned no text content");
  return text;
}

async function callOpenAi(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const headers = { Authorization: `Bearer ${keyFor("openai")}` };
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  /**
   * Two incompatibilities across OpenAI model generations, both of which
   * surface as a 400 rather than anything detectable up front:
   *   - reasoning-era models reject `max_tokens` and want
   *     `max_completion_tokens`
   *   - older models reject `response_format: json_object`
   * Rather than hard-coding which model is which — a list that goes stale —
   * try the modern shape and adapt once based on what the API objects to.
   */
  let body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };

  let res = await postWithRetry(OPENAI_URL, headers, body, "openai");

  if (res.status === 400) {
    const errText = await res.text();

    const wantsCompletionTokens = errText.includes("max_completion_tokens");
    const rejectsJsonMode = errText.includes("response_format");

    if (wantsCompletionTokens || rejectsJsonMode) {
      body = { model, messages };
      if (wantsCompletionTokens) body.max_completion_tokens = maxTokens;
      else body.max_tokens = maxTokens;
      if (!rejectsJsonMode) body.response_format = { type: "json_object" };

      console.warn(
        `[openai] retrying ${model} with adjusted parameters: ${errText.slice(0, 160)}`,
      );
      res = await postWithRetry(OPENAI_URL, headers, body, "openai");
    } else {
      throw new Error(`OpenAI API 400: ${errText.slice(0, 300)}`);
    }
  }

  if (!res.ok) {
    throw new Error(
      `OpenAI API ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no message content");
  return text;
}

/**
 * Run a system+user prompt through whichever provider is configured and
 * return the raw text. Callers parse it; `stripFences` handles models that
 * wrap JSON in a code fence.
 */
export async function complete(opts: {
  system: string;
  user: string;
  maxTokens: number;
  tier: ModelTier;
  /** Pass a pre-read settings object to avoid a second Firestore read. */
  settings?: AiSettings;
}): Promise<string> {
  const settings = opts.settings ?? (await getAiSettings());
  const { provider } = settings;

  const model =
    provider === "openai"
      ? opts.tier === "fast"
        ? settings.openaiFastModel
        : settings.openaiSmartModel
      : opts.tier === "fast"
        ? settings.anthropicFastModel
        : settings.anthropicSmartModel;

  return provider === "openai"
    ? callOpenAi(model, opts.system, opts.user, opts.maxTokens)
    : callAnthropic(model, opts.system, opts.user, opts.maxTokens);
}
