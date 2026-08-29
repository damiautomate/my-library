"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { auth } from "@/lib/firebase/client";

type Provider = "anthropic" | "openai";

interface Settings {
  provider: Provider;
  anthropicSmartModel: string;
  anthropicFastModel: string;
  openaiSmartModel: string;
  openaiFastModel: string;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
};

const ENV_NAME: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export default function AdminAiPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <AiContent />
    </AuthGuard>
  );
}

function AiContent() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [configured, setConfigured] = useState<Record<Provider, boolean>>({
    anthropic: false,
    openai: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const authedFetch = useCallback(
    async (init?: RequestInit) => {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      return fetch("/api/admin/ai-settings", {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load settings");
      setSettings(data.settings);
      setConfigured(data.configured);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await authedFetch({
        method: "PUT",
        body: JSON.stringify({
          provider: settings.provider,
          anthropic_smart_model: settings.anthropicSmartModel,
          anthropic_fast_model: settings.anthropicFastModel,
          openai_smart_model: settings.openaiSmartModel,
          openai_fast_model: settings.openaiFastModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setSettings(data.settings);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Settings>(key: K, v: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: v } : s));
    setSaved(false);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-12">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Admin · AI
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl">
          The Curator&apos;s Mind
        </h1>
        <p className="mt-3 max-w-xl text-sm text-ink-600">
          Which service powers the AI features — book classification when you
          add or import a book, and the narrator suggestion. Switch providers
          when one account runs out of credit; nothing else changes.
        </p>
      </header>

      {loading ? (
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-ink-500">
          Loading…
        </p>
      ) : !settings ? (
        <p className="text-sm text-oxblood-700">{error}</p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
              Provider
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["anthropic", "openai"] as const).map((p) => {
                const active = settings.provider === p;
                const hasKey = configured[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => set("provider", p)}
                    className={`rounded-sm border p-4 text-left transition-colors ${
                      active
                        ? "border-oxblood-600/60 bg-oxblood-50"
                        : "border-ink-500/25 bg-parchment-50 hover:bg-parchment-100"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-display text-lg text-ink-900">
                        {PROVIDER_LABEL[p]}
                      </span>
                      {active && (
                        <CheckCircle2 size={15} className="text-oxblood-700" />
                      )}
                    </span>
                    <span
                      className={`mt-2 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] ${
                        hasKey ? "text-forest-600" : "text-oxblood-700"
                      }`}
                    >
                      {hasKey ? (
                        <>
                          <CheckCircle2 size={11} /> Key configured
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={11} /> {ENV_NAME[p]} missing
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {!configured[settings.provider] && (
              <p className="mt-3 rounded-sm border border-oxblood-600/40 bg-oxblood-50/60 px-3 py-2 text-xs text-oxblood-700">
                {ENV_NAME[settings.provider]} isn&apos;t set on the server. Add
                it in Vercel → Settings → Environment Variables, redeploy, then
                come back and save.
              </p>
            )}
          </section>

          <section className="mb-8">
            <h2 className="mb-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
              Models
            </h2>
            <p className="mb-3 max-w-xl text-xs text-ink-600">
              <strong className="font-semibold">Classifier</strong> does the
              heavy work — reading the book and filling in every taxonomy field.{" "}
              <strong className="font-semibold">Quick tasks</strong> handles the
              small stuff, like picking a narrator. Editable because model
              availability differs per account; changing one takes effect
              immediately, without a redeploy.
            </p>

            <div className="space-y-4">
              <ModelRow
                label={`${PROVIDER_LABEL.anthropic} · Classifier`}
                value={settings.anthropicSmartModel}
                onChange={(v) => set("anthropicSmartModel", v)}
                dim={settings.provider !== "anthropic"}
              />
              <ModelRow
                label={`${PROVIDER_LABEL.anthropic} · Quick tasks`}
                value={settings.anthropicFastModel}
                onChange={(v) => set("anthropicFastModel", v)}
                dim={settings.provider !== "anthropic"}
              />
              <ModelRow
                label={`${PROVIDER_LABEL.openai} · Classifier`}
                value={settings.openaiSmartModel}
                onChange={(v) => set("openaiSmartModel", v)}
                dim={settings.provider !== "openai"}
              />
              <ModelRow
                label={`${PROVIDER_LABEL.openai} · Quick tasks`}
                value={settings.openaiFastModel}
                onChange={(v) => set("openaiFastModel", v)}
                dim={settings.provider !== "openai"}
              />
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t ml-hairline pt-5">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Save
            </Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-forest-600">
                <CheckCircle2 size={13} /> Saved — now using{" "}
                {PROVIDER_LABEL[settings.provider]}.
              </span>
            )}
            {error && <span className="text-xs text-oxblood-700">{error}</span>}
          </div>
        </>
      )}
    </main>
  );
}

function ModelRow({
  label,
  value,
  onChange,
  dim,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  dim: boolean;
}) {
  return (
    <div className={dim ? "opacity-50" : undefined}>
      <label className="mb-1.5 block font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-600">
        {label}
      </label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
