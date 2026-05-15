"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  LIFE_DOMAINS,
  LIFE_STAGES,
  ROOMS,
  READER_LEVELS,
  READING_MODES,
  CULTURAL_CONTEXTS,
  OUTCOME_SUGGESTIONS,
  FIELD_SUGGESTIONS,
  type LifeDomain,
  type LifeStage,
  type Room,
  type ReaderLevel,
  type ReadingMode,
  type CulturalContext,
} from "@/lib/taxonomy";
import { Tag } from "@/components/ui/Tag";

export interface ClassificationValue {
  life_domains: LifeDomain[];
  life_stages: LifeStage[];
  rooms: Room[];
  reader_level: ReaderLevel;
  reading_modes: ReadingMode[];
  cultural_contexts: CulturalContext[];
  outcomes: string[];
  fields: string[];
}

export const EMPTY_CLASSIFICATION: ClassificationValue = {
  life_domains: [],
  life_stages: [],
  rooms: [],
  reader_level: "intermediate",
  reading_modes: [],
  cultural_contexts: [],
  outcomes: [],
  fields: [],
};

interface PickerProps {
  value: ClassificationValue;
  onChange: (next: ClassificationValue) => void;
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function PickChip({
  label,
  active,
  onClick,
  tone = "neutral",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "neutral" | "accent" | "forest" | "gold";
}) {
  const baseTone =
    tone === "accent"
      ? "ml-chip--accent"
      : tone === "forest"
        ? "ml-chip--forest"
        : tone === "gold"
          ? "ml-chip--gold"
          : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "ml-chip cursor-pointer transition-all",
        active ? baseTone || "ml-chip--accent" : "",
        active && "ring-1 ring-ink-700/30",
        !active && "opacity-70 hover:opacity-100",
      )}
    >
      {label}
    </button>
  );
}

function FreeFormTagInput({
  values,
  suggestions,
  placeholder,
  onChange,
}: {
  values: string[];
  suggestions: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add(v: string) {
    const clean = v.trim().toLowerCase().replace(/\s+/g, "_");
    if (!clean) return;
    if (values.includes(clean)) return;
    onChange([...values, clean]);
    setDraft("");
  }

  const unused = suggestions.filter((s) => !values.includes(s));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <Tag key={v} tone="gold" onRemove={() => onChange(values.filter((x) => x !== v))}>
            {v}
          </Tag>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={placeholder}
          className="min-w-[10rem] flex-1 border-none bg-transparent text-sm placeholder:text-ink-500/70 focus:outline-none"
        />
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.slice(0, 16).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="font-mono text-[0.65rem] text-ink-500 hover:text-oxblood-700"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b ml-hairline pb-5 last:border-b-0">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h4 className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-ink-700">
          {label}
        </h4>
        {hint && <span className="text-[0.7rem] text-ink-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function ClassificationPicker({ value, onChange }: PickerProps) {
  return (
    <div className="ml-card p-6 space-y-5">
      <FieldGroup label="Life Domains" hint="Pick 1–4 primary domains">
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(LIFE_DOMAINS) as [LifeDomain, string][]).map(
            ([key, label]) => (
              <PickChip
                key={key}
                label={label}
                active={value.life_domains.includes(key)}
                onClick={() =>
                  onChange({
                    ...value,
                    life_domains: toggle(value.life_domains, key),
                  })
                }
              />
            ),
          )}
        </div>
      </FieldGroup>

      <FieldGroup label="Life Stages" hint="Where the book is most useful">
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(LIFE_STAGES) as [LifeStage, string][]).map(
            ([key, label]) => (
              <PickChip
                key={key}
                label={label}
                active={value.life_stages.includes(key)}
                tone="forest"
                onClick={() =>
                  onChange({
                    ...value,
                    life_stages: toggle(value.life_stages, key),
                  })
                }
              />
            ),
          )}
        </div>
      </FieldGroup>

      <FieldGroup label="Rooms" hint="Usually one room, sometimes two">
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(ROOMS) as [Room, typeof ROOMS[Room]][]).map(
            ([key, r]) => (
              <PickChip
                key={key}
                label={r.label.replace(/^The /, "")}
                active={value.rooms.includes(key)}
                onClick={() =>
                  onChange({ ...value, rooms: toggle(value.rooms, key) })
                }
              />
            ),
          )}
        </div>
      </FieldGroup>

      <FieldGroup label="Reader Level">
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(READER_LEVELS) as [ReaderLevel, string][]).map(
            ([key, label]) => (
              <PickChip
                key={key}
                label={label}
                active={value.reader_level === key}
                onClick={() => onChange({ ...value, reader_level: key })}
              />
            ),
          )}
        </div>
      </FieldGroup>

      <FieldGroup label="Reading Modes">
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(READING_MODES) as [ReadingMode, string][]).map(
            ([key, label]) => (
              <PickChip
                key={key}
                label={label}
                active={value.reading_modes.includes(key)}
                onClick={() =>
                  onChange({
                    ...value,
                    reading_modes: toggle(value.reading_modes, key),
                  })
                }
              />
            ),
          )}
        </div>
      </FieldGroup>

      <FieldGroup label="Cultural Contexts">
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(CULTURAL_CONTEXTS) as [CulturalContext, string][]).map(
            ([key, label]) => (
              <PickChip
                key={key}
                label={label}
                active={value.cultural_contexts.includes(key)}
                onClick={() =>
                  onChange({
                    ...value,
                    cultural_contexts: toggle(value.cultural_contexts, key),
                  })
                }
              />
            ),
          )}
        </div>
      </FieldGroup>

      <FieldGroup
        label="Outcomes"
        hint="Press Enter to add. Free-form."
      >
        <FreeFormTagInput
          values={value.outcomes}
          suggestions={OUTCOME_SUGGESTIONS}
          placeholder="e.g. build_habits"
          onChange={(outcomes) => onChange({ ...value, outcomes })}
        />
      </FieldGroup>

      <FieldGroup
        label="Fields"
        hint="Press Enter to add. Free-form."
      >
        <FreeFormTagInput
          values={value.fields}
          suggestions={FIELD_SUGGESTIONS}
          placeholder="e.g. engineering"
          onChange={(fields) => onChange({ ...value, fields })}
        />
      </FieldGroup>
    </div>
  );
}
