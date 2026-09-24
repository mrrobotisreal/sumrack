import type { WordProfileRow } from '@/db/repositories/word-forms';
import {
  DEFAULT_MODEL_TABLE,
  EFFORT_LABELS,
  MODEL_HINTS,
  PROVIDER_LABELS,
  QUALITY_LABELS,
  type AiProvider,
  type AiQuality,
} from '@/features/ai/run-profile';

import { getCatalogEntry, SECTION_CATALOG } from './profile-core';
import type { ProfileSection, WordProfile } from './profile-schema';

/**
 * Pure presentation helpers for the Forms tab (M16/T53, WORD_FORMS §7.2).
 * Everything here is unit-tested under Node; the components only lay out
 * what these return. T54 reuses `formatReceiptLine` for lesson receipts.
 */

// --- receipts -----------------------------------------------------------------

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** «24 Sep 2026 14:05» in local time — table-driven (Hermes locale data is thin). */
export function formatReceiptDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** «$0.18» · «< $0.01» · «cost n/a» (usage missing from the response). */
export function formatCost(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined) return 'cost n/a';
  if (costUsd < 0.005) return '< $0.01';
  return `$${costUsd.toFixed(2)}`;
}

/** «65 s» · «2.4 s» for sub-10-second runs. */
export function formatDuration(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

/**
 * The human model name for a receipt: the notch's hint when the stored slug
 * is the one the default table maps there, otherwise the slug itself (the
 * table is editable — a receipt must never claim a model it did not use).
 */
export function modelHintFor(provider: AiProvider, quality: AiQuality, model: string): string {
  return DEFAULT_MODEL_TABLE[provider][quality] === model ? MODEL_HINTS[provider][quality] : model;
}

export type ReceiptLike = Pick<
  WordProfileRow,
  | 'createdAt'
  | 'provider'
  | 'model'
  | 'quality'
  | 'effort'
  | 'effortApplied'
  | 'costUsd'
  | 'durationMs'
>;

/**
 * «24 Sep 2026 14:05 · Anthropic · Claude Opus 5.5 · Normal · High · $0.18 · 65 s»;
 * «effort n/a» replaces the effort label when the param was rejected (§8).
 */
export function formatReceiptLine(row: ReceiptLike): string {
  return [
    formatReceiptDate(row.createdAt),
    PROVIDER_LABELS[row.provider],
    modelHintFor(row.provider, row.quality, row.model),
    QUALITY_LABELS[row.quality],
    row.effortApplied ? EFFORT_LABELS[row.effort] : 'effort n/a',
    formatCost(row.costUsd),
    formatDuration(row.durationMs),
  ].join(' · ');
}

// --- section order ------------------------------------------------------------

const CATALOG_INDEX = new Map(SECTION_CATALOG.map((e, i) => [e.id, i]));

/**
 * Sections in catalog order; model-added `x-…` (or otherwise unknown) ids
 * keep their own relative order after every catalog section (§5.3). The
 * validator already enforces this for stored profiles — the renderer
 * re-sorts anyway so an older payload never renders out of order.
 */
export function sectionOrder(profile: Pick<WordProfile, 'sections'>): ProfileSection[] {
  const rank = (s: ProfileSection) => CATALOG_INDEX.get(s.id) ?? Number.POSITIVE_INFINITY;
  return profile.sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

/** Catalog title when the id is known (the model's own title otherwise). */
export function sectionTitle(section: ProfileSection): { en: string; ru: string } {
  return getCatalogEntry(section.id)?.title ?? section.title;
}

// --- tag pills ----------------------------------------------------------------

export interface TagStyle {
  /** Pill background class (a 15 % wash) + text class — theme tokens only. */
  bg: string;
  text: string;
  /** What the pill shows (`prefix:по-` → `по-`). */
  label: string;
}

const TAG_STYLES: Record<string, Pick<TagStyle, 'bg' | 'text'>> = {
  // ember = the accent (perfective is the "completed" hue, like C1)
  pf: { bg: 'bg-accent-soft', text: 'text-accent' },
  // slate = the A1 hue (imperfective, the ongoing one)
  impf: { bg: 'bg-level-a1/15', text: 'text-level-a1' },
  refl: { bg: 'bg-level-a2/15', text: 'text-level-a2' },
  partner: { bg: 'bg-accent-soft', text: 'text-accent' },
};
const MUTED: Pick<TagStyle, 'bg' | 'text'> = { bg: 'bg-surface-2', text: 'text-text-muted' };

/** `pf` ember · `impf` slate · `refl` sage · `partner` accent · `prefix:…` and everything else muted. */
export function tagStyle(tag: string): TagStyle {
  if (tag.startsWith('prefix:')) return { ...MUTED, label: tag.slice('prefix:'.length) || tag };
  return { ...(TAG_STYLES[tag] ?? MUTED), label: tag };
}

// --- expanded-set reducer -----------------------------------------------------

export const INITIAL_EXPANDED_COUNT = 2;

/** The first two sections start expanded (§7.2). */
export function initialExpanded(sectionIds: readonly string[]): ReadonlySet<string> {
  return new Set(sectionIds.slice(0, INITIAL_EXPANDED_COUNT));
}

/** Immutable toggle — returns a new set so React state changes identity. */
export function toggleExpanded(expanded: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// --- grid ---------------------------------------------------------------------

/** Adjective-wide grids (> 2 value columns) scroll horizontally inside the card (§7.2). */
export function gridScrollsHorizontally(colLabels: readonly string[]): boolean {
  return colLabels.length > 2;
}
