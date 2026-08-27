import type { CefrLevel } from '@/components/level-chip';

/**
 * Story-family grouping (T30.1): pure derivation over installed pack rows —
 * packs sharing a `family:<slug>` tag (shipped since CT001 exactly for this)
 * collapse into one Library shelf with a level selector. Zero schema change;
 * everything here is presentation-time logic, unit-tested without a DB.
 */

export const CEFR_ORDER: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

const cefrRank = (level: CefrLevel): number => CEFR_ORDER.indexOf(level);

// Strict slug shape — a malformed family tag (empty, uppercase, spaces,
// unexpected characters) means the pack is treated as untagged, per ticket.
const FAMILY_TAG = /^family:([a-z0-9][a-z0-9-]*)$/;

/** First well-formed `family:<slug>` tag, or null (malformed → untagged). */
export function parseFamilySlug(tags: readonly string[]): string | null {
  for (const tag of tags) {
    const match = FAMILY_TAG.exec(tag);
    if (match?.[1]) return match[1];
  }
  return null;
}

export interface FamilyMember {
  packId: string;
  level: CefrLevel;
  tags: string[];
}

export type FamilyGroupResult<T> =
  { kind: 'single'; item: T } | { kind: 'family'; slug: string; members: T[] };

/**
 * Collapse a positioned section list into family shelves. A family shelf
 * takes the list position of its FIRST member (= lowest installed rung under
 * the Library's pack-id ordering — the CT002b placement fix: a newly synced
 * higher rung joins the existing shelf instead of appending far away).
 * Families with fewer than 2 installed members render as plain sections —
 * no premature shelf chrome. Members are returned in CEFR order.
 */
export function groupByFamily<T>(
  items: readonly T[],
  getMember: (item: T) => FamilyMember,
): FamilyGroupResult<T>[] {
  const bySlug = new Map<string, T[]>();
  for (const item of items) {
    const slug = parseFamilySlug(getMember(item).tags);
    if (!slug) continue;
    const list = bySlug.get(slug) ?? [];
    list.push(item);
    bySlug.set(slug, list);
  }

  const grouped = new Set<string>();
  const result: FamilyGroupResult<T>[] = [];
  for (const item of items) {
    const slug = parseFamilySlug(getMember(item).tags);
    const members = slug ? bySlug.get(slug) : undefined;
    if (!slug || !members || members.length < 2) {
      result.push({ kind: 'single', item });
      continue;
    }
    if (grouped.has(slug)) continue; // already shelved at the first member's position
    grouped.add(slug);
    const sorted = [...members].sort(
      (a, b) => cefrRank(getMember(a).level) - cefrRank(getMember(b).level),
    );
    result.push({ kind: 'family', slug, members: sorted });
  }
  return result;
}

/** Per-rung read-state summary the selector rules consume. */
export interface RungState {
  level: CefrLevel;
  storyCount: number;
  finishedCount: number;
  /** max story_progress.updatedAt across the rung's stories, null = never opened. */
  lastReadAt: number | null;
}

export function rungFinished(rung: RungState): boolean {
  return rung.storyCount > 0 && rung.finishedCount >= rung.storyCount;
}

/**
 * Default selected rung (recorded decision, ticket item 3): the
 * most-recently-read rung; fallback = lowest rung with unfinished stories;
 * fallback = lowest rung. Deterministic — ties on recency go to the lower
 * level. `rungs` must be non-empty and in CEFR order.
 */
export function defaultRungLevel(rungs: readonly RungState[]): CefrLevel {
  let recent: RungState | null = null;
  for (const rung of rungs) {
    if (
      rung.lastReadAt != null &&
      (recent === null || rung.lastReadAt > (recent.lastReadAt ?? 0))
    ) {
      recent = rung;
    }
  }
  if (recent) return recent.level;
  const unfinished = rungs.find((rung) => !rungFinished(rung));
  if (unfinished) return unfinished.level;
  return rungs[0]!.level;
}

/**
 * Next-rung affordance (ticket item 4): only when the selected rung is fully
 * finished AND a higher rung is installed — returns the lowest installed
 * level strictly above the selection, else null (nothing to nudge toward).
 */
export function nextRungLevel(rungs: readonly RungState[], selected: CefrLevel): CefrLevel | null {
  const current = rungs.find((rung) => rung.level === selected);
  if (!current || !rungFinished(current)) return null;
  const higher = rungs.find((rung) => cefrRank(rung.level) > cefrRank(selected));
  return higher ? higher.level : null;
}

/**
 * Shelf header tag chrome (recorded decision, ticket item 2): the tags every
 * installed rung shares, minus the `family:*` mechanism tag and the per-level
 * `grammar:*` noise — for tall-dog that leaves `creepypasta` + `horror`.
 * Order follows the first (lowest) rung's tag order.
 */
export function sharedShelfTags(tagLists: readonly (readonly string[])[]): string[] {
  const [first, ...rest] = tagLists;
  if (!first) return [];
  return first.filter(
    (tag) =>
      !tag.startsWith('family:') &&
      !tag.startsWith('grammar:') &&
      rest.every((tags) => tags.includes(tag)),
  );
}
