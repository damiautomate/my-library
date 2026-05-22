"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Check,
  Loader2,
  AlertTriangle,
  X,
  Volume2,
  Info,
} from "lucide-react";
import {
  VOICE_CATALOG,
  DEFAULT_VOICE_ID,
  getVoiceById,
  type VoiceMeta,
} from "@/lib/voices";
import { auth as firebaseAuth } from "@/lib/firebase/client";
import { updateBook } from "@/lib/books";
import type { Book } from "@/lib/types";

/**
 * Narrator picker — the per-book voice selection UI (Phase 9q).
 *
 * Default state shows the currently-selected narrator with two CTAs:
 *   - "Let AI pick" — calls /api/books/[id]/suggest-voice, surfaces the
 *     recommendation and lets the user accept or ask for another
 *   - "Choose manually" — expands the full catalog grouped by mode
 *
 * The catalog uses card components — name + accent + tone + ▶ preview + select.
 * Premium voices live in a separate, distinctly-styled section with an
 * inline note about the trade-off (no live highlight in exchange for
 * Studio-quality narration).
 *
 * Selection saves immediately via updateBook(). If the chosen voice differs
 * from the voice that produced existing segments, a warning surfaces — and
 * the next "Re-generate" call (in ConversionActions) will auto-reset and
 * regenerate cleanly in the new voice.
 */

interface NarratorPickerProps {
  book: Book;
  /** True when the book already has voice segments — used to surface the
   * "Changing the narrator will require regenerating" warning. */
  hasVoice: boolean;
  /** Called after a successful voice change so the parent can refresh. */
  onChanged?: () => void;
}

interface AiSuggestion {
  voice_id: string;
  voice_mode: "synced" | "premium";
  display_name: string;
  reasoning: string;
}

export function NarratorPicker({
  book,
  hasVoice,
  onChanged,
}: NarratorPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiExcluded, setAiExcluded] = useState<string[]>([]);
  const [savingVoiceId, setSavingVoiceId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Preview audio — a single shared <audio> element so playing voice B
  // automatically stops voice A's preview.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const currentVoiceId = book.voice_id ?? DEFAULT_VOICE_ID;
  const currentVoice = getVoiceById(currentVoiceId);

  // Cleanup audio on unmount so a preview doesn't keep playing after the
  // user closes the picker section.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  async function authHeader(): Promise<string> {
    const u = firebaseAuth.currentUser;
    if (!u) throw new Error("Not signed in");
    return `Bearer ${await u.getIdToken()}`;
  }

  async function handlePreview(voice: VoiceMeta) {
    if (previewingId === voice.id) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewLoadingId(voice.id);
    setSaveError(null);
    try {
      // Pre-flight fetch the sample route BEFORE handing the URL to <audio>.
      // The route returns 302 -> Cloudinary on success (which fetch follows
      // transparently, giving us the MP3) or JSON 5xx on failure (e.g.
      // Google TTS billing not enabled). Without this pre-check, every
      // failure mode reaches the audio element as a generic "no supported
      // source" message, which is unhelpful — especially because the most
      // common failure (Google billing) has a long, specific error message
      // the user actually needs to see.
      const r = await fetch(`/api/voice-samples/${voice.id}`);
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Preview failed (HTTP ${r.status})`);
      }
      // r.url here is the post-redirect Cloudinary URL — the MP3 itself.
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = r.url;
      audio.onended = () => setPreviewingId(null);
      audio.onerror = () =>
        setSaveError("Preview failed: browser couldn't play the audio file.");
      audio.onpause = () => {
        // Only clear previewingId if pause wasn't caused by switching tracks
        if (audioRef.current?.src === r.url) setPreviewingId(null);
      };
      await audio.play();
      setPreviewingId(voice.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Show enough of the message to be useful — Google's billing message
      // is ~300 chars including the project URL the user needs to visit.
      setSaveError(`Preview failed: ${msg.slice(0, 300)}`);
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleSelect(voiceId: string) {
    if (voiceId === currentVoiceId) return;
    setSavingVoiceId(voiceId);
    setSaveError(null);
    try {
      const voice = getVoiceById(voiceId);
      await updateBook(book.id, {
        voice_id: voice.id,
        voice_mode: voice.mode,
      });
      onChanged?.();
      // Clear any AI suggestion overlay once a manual pick is committed
      setAiSuggestion(null);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to update narrator",
      );
    } finally {
      setSavingVoiceId(null);
    }
  }

  async function handleAiSuggest(excludeAdditional?: string) {
    setAiLoading(true);
    setAiError(null);
    const newExcluded = excludeAdditional
      ? [...aiExcluded, excludeAdditional]
      : aiExcluded;
    setAiExcluded(newExcluded);
    try {
      const res = await fetch(`/api/books/${book.id}/suggest-voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ exclude: newExcluded }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Failed (${res.status})`);
      }
      setAiSuggestion(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  function dismissAi() {
    setAiSuggestion(null);
    setAiError(null);
    setAiExcluded([]);
  }

  async function acceptAi() {
    if (!aiSuggestion) return;
    await handleSelect(aiSuggestion.voice_id);
    dismissAi();
  }

  // Voice change warning — when picking a voice that differs from the one
  // that generated the existing audio. The auto-reset in generate-voice
  // handles the actual cleanup, but the user should know.
  const showRegenWarning = hasVoice;

  const syncedVoices = VOICE_CATALOG.filter((v) => v.mode === "synced");
  const premiumVoices = VOICE_CATALOG.filter((v) => v.mode === "premium");

  return (
    <div className="mt-3 rounded-sm border border-ink-500/15 bg-parchment-50/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
          Narrator
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500 hover:text-ink-700"
        >
          {expanded ? (
            <>
              Collapse <ChevronUp size={11} />
            </>
          ) : (
            <>
              Choose manually <ChevronDown size={11} />
            </>
          )}
        </button>
      </div>

      {/* Current narrator card */}
      <CurrentNarratorCard
        voice={currentVoice}
        onPreview={() => handlePreview(currentVoice)}
        isPreviewing={previewingId === currentVoice.id}
        isPreviewLoading={previewLoadingId === currentVoice.id}
      />

      {/* Primary CTA — Let AI pick */}
      {!aiSuggestion && !aiLoading && (
        <button
          type="button"
          onClick={() => handleAiSuggest()}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-50 px-3 py-2 text-xs text-oxblood-700 hover:bg-oxblood-100 sm:w-auto"
        >
          <Sparkles size={13} />
          Let AI pick the narrator
        </button>
      )}

      {/* AI suggestion panel */}
      {(aiLoading || aiSuggestion || aiError) && (
        <div className="mt-3 rounded-sm border border-oxblood-200 bg-oxblood-50/40 p-3">
          {aiLoading && (
            <div className="flex items-center gap-2 text-xs text-ink-700">
              <Loader2 size={13} className="animate-spin" />
              Thinking about who should read this book…
            </div>
          )}
          {aiError && !aiLoading && (
            <div className="flex items-start gap-2 text-xs text-oxblood-700">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p>{aiError}</p>
                <button
                  type="button"
                  onClick={() => handleAiSuggest()}
                  className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-oxblood-700 hover:underline"
                >
                  Try again
                </button>
              </div>
              <button
                type="button"
                onClick={dismissAi}
                className="ml-auto text-ink-500 hover:text-ink-700"
              >
                <X size={13} />
              </button>
            </div>
          )}
          {aiSuggestion && !aiLoading && (
            <div>
              <div className="mb-2 flex items-start gap-2">
                <Sparkles
                  size={13}
                  className="mt-0.5 flex-shrink-0 text-oxblood-700"
                />
                <p className="flex-1 text-xs text-ink-800">
                  AI recommends{" "}
                  <strong className="font-display">
                    {aiSuggestion.display_name}
                  </strong>{" "}
                  {aiSuggestion.voice_mode === "premium" && (
                    <span className="ml-1 inline-flex items-center rounded-sm bg-forest-600 px-1.5 py-0.5 align-middle font-mono text-[0.55rem] uppercase tracking-[0.1em] text-parchment-50">
                      Premium
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={dismissAi}
                  className="ml-auto text-ink-500 hover:text-ink-700"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="mb-3 pl-5 text-xs italic text-ink-700">
                &ldquo;{aiSuggestion.reasoning}&rdquo;
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={acceptAi}
                  disabled={savingVoiceId !== null}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-700 px-3 py-1.5 text-xs text-parchment-50 hover:bg-oxblood-800 disabled:opacity-50"
                >
                  {savingVoiceId === aiSuggestion.voice_id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Check size={11} />
                  )}
                  Use {aiSuggestion.display_name}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handlePreview(getVoiceById(aiSuggestion.voice_id))
                  }
                  className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-ink-700 hover:bg-parchment-100"
                >
                  {previewingId === aiSuggestion.voice_id ? (
                    <Pause size={11} />
                  ) : previewLoadingId === aiSuggestion.voice_id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Play size={11} />
                  )}
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => handleAiSuggest(aiSuggestion.voice_id)}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-ink-700 hover:bg-parchment-100"
                >
                  <Sparkles size={11} />
                  Try another
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Regen warning */}
      {showRegenWarning && (
        <p className="mt-3 flex items-start gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
          <Info size={11} className="mt-0.5 flex-shrink-0" />
          Changing the narrator will require regenerating the audio.
        </p>
      )}

      {saveError && (
        <p className="mt-2 text-xs text-oxblood-700">{saveError}</p>
      )}

      {/* Manual catalog */}
      {expanded && (
        <div className="mt-4 space-y-5">
          <CatalogSection
            title="Synced narrators"
            blurb="These voices support live paragraph highlighting in the reader as the audio plays."
            voices={syncedVoices}
            currentVoiceId={currentVoiceId}
            savingVoiceId={savingVoiceId}
            previewingId={previewingId}
            previewLoadingId={previewLoadingId}
            onPreview={handlePreview}
            onSelect={handleSelect}
          />
          <CatalogSection
            title="Premium narrators"
            blurb="Studio-grade Google voices — much more natural, cinematic delivery. No live highlight while playing (best for books you listen to rather than read along with)."
            voices={premiumVoices}
            currentVoiceId={currentVoiceId}
            savingVoiceId={savingVoiceId}
            previewingId={previewingId}
            previewLoadingId={previewLoadingId}
            onPreview={handlePreview}
            onSelect={handleSelect}
            badge="Premium"
          />
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

interface CurrentNarratorCardProps {
  voice: VoiceMeta;
  onPreview: () => void;
  isPreviewing: boolean;
  isPreviewLoading: boolean;
}

function CurrentNarratorCard({
  voice,
  onPreview,
  isPreviewing,
  isPreviewLoading,
}: CurrentNarratorCardProps) {
  const initial = voice.displayName[0].toUpperCase();
  return (
    <div className="flex items-center gap-3 rounded-sm border border-ink-500/15 bg-parchment-50 p-3">
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display text-base ${
          voice.gender === "female"
            ? "bg-oxblood-100 text-oxblood-700"
            : "bg-forest-600/15 text-forest-600"
        }`}
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-display text-sm text-ink-900">
            {voice.displayName}
          </p>
          <Badge>{voice.accent}</Badge>
          {voice.mode === "premium" && (
            <Badge tone="forest">Premium</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-600">{voice.description}</p>
      </div>
      <button
        type="button"
        onClick={onPreview}
        className="inline-flex items-center gap-1 rounded-sm border border-ink-500/30 bg-parchment-50 px-2 py-1 text-xs text-ink-700 hover:bg-parchment-100"
        aria-label={isPreviewing ? "Stop preview" : "Play preview"}
      >
        {isPreviewing ? (
          <Pause size={12} />
        ) : isPreviewLoading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Play size={12} />
        )}
      </button>
    </div>
  );
}

interface CatalogSectionProps {
  title: string;
  blurb: string;
  voices: VoiceMeta[];
  currentVoiceId: string;
  savingVoiceId: string | null;
  previewingId: string | null;
  previewLoadingId: string | null;
  onPreview: (v: VoiceMeta) => void;
  onSelect: (voiceId: string) => void;
  badge?: string;
}

function CatalogSection({
  title,
  blurb,
  voices,
  currentVoiceId,
  savingVoiceId,
  previewingId,
  previewLoadingId,
  onPreview,
  onSelect,
  badge,
}: CatalogSectionProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Volume2 size={12} className="text-ink-500" />
        <p className="font-display text-sm text-ink-900">{title}</p>
        {badge && <Badge tone="forest">{badge}</Badge>}
      </div>
      <p className="mb-3 max-w-2xl text-xs text-ink-600">{blurb}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {voices.map((v) => (
          <VoiceCard
            key={v.id}
            voice={v}
            selected={currentVoiceId === v.id}
            saving={savingVoiceId === v.id}
            previewing={previewingId === v.id}
            previewLoading={previewLoadingId === v.id}
            onPreview={() => onPreview(v)}
            onSelect={() => onSelect(v.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface VoiceCardProps {
  voice: VoiceMeta;
  selected: boolean;
  saving: boolean;
  previewing: boolean;
  previewLoading: boolean;
  onPreview: () => void;
  onSelect: () => void;
}

function VoiceCard({
  voice,
  selected,
  saving,
  previewing,
  previewLoading,
  onPreview,
  onSelect,
}: VoiceCardProps) {
  const initial = voice.displayName[0].toUpperCase();
  return (
    <div
      className={`relative flex flex-col gap-2 rounded-sm border p-3 transition-colors ${
        selected
          ? "border-oxblood-700 bg-oxblood-50/60"
          : "border-ink-500/15 bg-parchment-50 hover:border-ink-500/30"
      }`}
    >
      {selected && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-oxblood-700 text-parchment-50">
          <Check size={11} />
        </span>
      )}
      <div className="flex items-center gap-2">
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-display text-sm ${
            voice.gender === "female"
              ? "bg-oxblood-100 text-oxblood-700"
              : "bg-forest-600/15 text-forest-600"
          }`}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-ink-900">
            {voice.displayName}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Badge subtle>{voice.accent}</Badge>
            <Badge subtle>
              {voice.gender === "female" ? "Female" : "Male"}
            </Badge>
            <Badge subtle>{voice.provider === "aws" ? "AWS" : "Google"}</Badge>
          </div>
        </div>
      </div>
      <p className="text-xs leading-snug text-ink-600">{voice.description}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPreview}
          disabled={previewLoading}
          className="inline-flex items-center gap-1 rounded-sm border border-ink-500/30 bg-parchment-50 px-2 py-1 text-xs text-ink-700 hover:bg-parchment-100 disabled:opacity-50"
        >
          {previewing ? (
            <Pause size={11} />
          ) : previewLoading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Play size={11} />
          )}
          Preview
        </button>
        <button
          type="button"
          onClick={onSelect}
          disabled={saving || selected}
          className={`flex-1 inline-flex items-center justify-center gap-1 rounded-sm border px-2 py-1 text-xs disabled:opacity-50 ${
            selected
              ? "border-forest-600 bg-forest-600/10 text-forest-600"
              : "border-ink-500/30 bg-parchment-50 text-ink-700 hover:bg-parchment-100"
          }`}
        >
          {saving ? (
            <Loader2 size={11} className="animate-spin" />
          ) : selected ? (
            <>
              <Check size={11} /> Selected
            </>
          ) : (
            "Select"
          )}
        </button>
      </div>
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  tone?: "default" | "forest";
  subtle?: boolean;
}
function Badge({ children, tone = "default", subtle }: BadgeProps) {
  const tones = {
    default: subtle
      ? "bg-ink-500/10 text-ink-600"
      : "bg-ink-500/15 text-ink-700",
    forest: subtle
      ? "bg-forest-600/15 text-forest-600"
      : "bg-forest-600 text-parchment-50",
  };
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
