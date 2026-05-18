"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal, X as XIcon } from "lucide-react";
import clsx from "clsx";
import {
  LIFE_DOMAINS,
  LIFE_STAGES,
  ROOMS,
  READER_LEVELS,
  READING_MODES,
  CULTURAL_CONTEXTS,
  LANGUAGES,
  type LifeDomain,
  type LifeStage,
  type Room,
  type ReaderLevel,
  type ReadingMode,
  type CulturalContext,
} from "@/lib/taxonomy";

export interface Filters {
  domains: LifeDomain[];
  stages: LifeStage[];
  rooms: Room[];
  levels: ReaderLevel[];
  modes: ReadingMode[];
  contexts: CulturalContext[];
  languages: string[];
}

export const EMPTY_FILTERS: Filters = {
  domains: [],
  stages: [],
  rooms: [],
  levels: [],
  modes: [],
  contexts: [],
  languages: [],
};

interface SidebarProps {
  filters: Filters;
  onChange: (next: Filters) => void;
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b ml-hairline py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-700"
      >
        <span>{title}</span>
        <ChevronDown
          size={14}
          className={clsx("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="mt-3 flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

function FacetChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-oxblood-600/60 bg-oxblood-50 text-oxblood-700"
          : "border-ink-500/25 bg-parchment-50 text-ink-700 hover:bg-parchment-100",
      )}
    >
      {label}
    </button>
  );
}

export function FilterSidebar({ filters, onChange }: SidebarProps) {
  const activeCount = Object.values(filters).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const [open, setOpen] = useState(false);

  const sections = (
    <>
      <Section title="Room" defaultOpen>
        {(Object.entries(ROOMS) as [Room, typeof ROOMS[Room]][]).map(
          ([key, r]) => (
            <FacetChip
              key={key}
              label={r.label.replace(/^The /, "")}
              active={filters.rooms.includes(key)}
              onClick={() =>
                onChange({ ...filters, rooms: toggle(filters.rooms, key) })
              }
            />
          ),
        )}
      </Section>

      <Section title="Life Domain" defaultOpen>
        {(Object.entries(LIFE_DOMAINS) as [LifeDomain, string][]).map(
          ([key, label]) => (
            <FacetChip
              key={key}
              label={label}
              active={filters.domains.includes(key)}
              onClick={() =>
                onChange({
                  ...filters,
                  domains: toggle(filters.domains, key),
                })
              }
            />
          ),
        )}
      </Section>

      <Section title="Life Stage">
        {(Object.entries(LIFE_STAGES) as [LifeStage, string][]).map(
          ([key, label]) => (
            <FacetChip
              key={key}
              label={label.replace(/^Stage \d — /, "")}
              active={filters.stages.includes(key)}
              onClick={() =>
                onChange({ ...filters, stages: toggle(filters.stages, key) })
              }
            />
          ),
        )}
      </Section>

      <Section title="Reader Level">
        {(Object.entries(READER_LEVELS) as [ReaderLevel, string][]).map(
          ([key, label]) => (
            <FacetChip
              key={key}
              label={label}
              active={filters.levels.includes(key)}
              onClick={() =>
                onChange({ ...filters, levels: toggle(filters.levels, key) })
              }
            />
          ),
        )}
      </Section>

      <Section title="Reading Mode">
        {(Object.entries(READING_MODES) as [ReadingMode, string][]).map(
          ([key, label]) => (
            <FacetChip
              key={key}
              label={label}
              active={filters.modes.includes(key)}
              onClick={() =>
                onChange({ ...filters, modes: toggle(filters.modes, key) })
              }
            />
          ),
        )}
      </Section>

      <Section title="Cultural Context">
        {(Object.entries(CULTURAL_CONTEXTS) as [CulturalContext, string][]).map(
          ([key, label]) => (
            <FacetChip
              key={key}
              label={label}
              active={filters.contexts.includes(key)}
              onClick={() =>
                onChange({
                  ...filters,
                  contexts: toggle(filters.contexts, key),
                })
              }
            />
          ),
        )}
      </Section>

      <Section title="Language">
        {Object.entries(LANGUAGES).map(([code, label]) => (
          <FacetChip
            key={code}
            label={label}
            active={filters.languages.includes(code)}
            onClick={() =>
              onChange({
                ...filters,
                languages: toggle(filters.languages, code),
              })
            }
          />
        ))}
      </Section>
    </>
  );

  const header = (
    <div className="flex items-center justify-between pb-2">
      <h2 className="font-display text-lg">Filters</h2>
      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:underline"
        >
          Clear {activeCount}
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: trigger button + sticky chip count */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-2 text-sm text-ink-800 hover:bg-parchment-100"
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && (
            <span className="ml-1 rounded-full bg-oxblood-600 px-2 py-0.5 font-mono text-[0.65rem] text-parchment-50">
              {activeCount}
            </span>
          )}
        </button>

        {open && (
          <div
            className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          >
            <div
              className="ml-auto flex h-full w-80 max-w-[90vw] flex-col bg-parchment-50 shadow-paper-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b ml-hairline px-5 py-3">
                <h2 className="font-display text-lg">Filters</h2>
                <div className="flex items-center gap-2">
                  {activeCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onChange(EMPTY_FILTERS)}
                      className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:underline"
                    >
                      Clear {activeCount}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-sm p-1 text-ink-600 hover:bg-parchment-100"
                    aria-label="Close filters"
                  >
                    <XIcon size={16} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-6">{sections}</div>
              <div className="border-t ml-hairline px-5 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full rounded-sm border border-oxblood-700 bg-oxblood-600 px-4 py-2 text-sm text-parchment-50 hover:bg-oxblood-700"
                >
                  Show results
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Desktop: inline sidebar */}
      <aside className="hidden flex-shrink-0 lg:block lg:w-64">
        {header}
        {sections}
      </aside>
    </>
  );
}

/** Pure-function filter applied client-side over a Book[]. */
export function applyFilters<T extends {
  life_domains?: string[];
  life_stages?: string[];
  rooms?: string[];
  reader_level?: string;
  reading_modes?: string[];
  cultural_contexts?: string[];
  language?: string;
}>(items: T[], f: Filters): T[] {
  return items.filter((b) => {
    if (f.domains.length && !f.domains.some((d) => b.life_domains?.includes(d)))
      return false;
    if (f.stages.length && !f.stages.some((s) => b.life_stages?.includes(s)))
      return false;
    if (f.rooms.length && !f.rooms.some((r) => b.rooms?.includes(r))) return false;
    if (
      f.levels.length &&
      (!b.reader_level || !f.levels.includes(b.reader_level as ReaderLevel))
    )
      return false;
    if (f.modes.length && !f.modes.some((m) => b.reading_modes?.includes(m)))
      return false;
    if (
      f.contexts.length &&
      !f.contexts.some((c) => b.cultural_contexts?.includes(c))
    )
      return false;
    if (f.languages.length && (!b.language || !f.languages.includes(b.language)))
      return false;
    return true;
  });
}
