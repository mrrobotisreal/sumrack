import {
  ALL_GENRES,
  CATEGORIES,
  CATEGORY_ORDER,
  GENRE_ORDER,
  classifyPack,
  labelForCategory,
  labelForGenre,
  type IoniconName,
} from '@/features/library/categories';
import type { PackRow } from '@/db/repositories/content';
import { formatRuDate } from '@/lib/ru-date';

/**
 * Library shelf filtering, ordering and captions (M14, T45 —
 * LIBRARY_CATEGORIES §3/§4). Pure derivation over the section list the
 * screen already builds, sibling of family-groups.ts: `filterSectionsByCategory`
 * runs BEFORE `groupByFamily` (so a family shelf can only ever hold rungs of
 * the selected category), `genreRowItems` decides whether the genre sub-row
 * renders, `orderRowsForCategory` gives news its newest-first order, and
 * `storyRowCaption` renders `source.name · date` captions (date helpers
 * live in `lib/ru-date.ts` since T46). Unit-tested
 * without a DB; the chip row itself is verified on-device (node env).
 */

export type FilterablePack = Pick<PackRow, 'id' | 'type' | 'category' | 'genre' | 'origin'>;

export interface LibraryFilter {
  category: string;
  /** Genre slug or ALL_GENRES — only consulted when `category === 'stories'`. */
  genre: string;
}

/** One chip of a `ChipRow` — shared by the category and genre rows. */
export interface ChipItem<T extends string = string> {
  key: T;
  label: string;
  icon?: IoniconName;
  count?: number;
}

const isRemoteStories = (pack: FilterablePack): boolean =>
  pack.origin !== 'local' && classifyPack(pack).category === 'stories';

/**
 * Keep the sections whose pack classifies into `category`; inside «Истории»
 * additionally match the genre when one is selected (`genre ?? ''` so the
 * genre-less dialogue only ever shows under «Все»). Input order is preserved
 * — the pack-id ordering `groupByFamily` relies on survives untouched.
 */
export function filterSectionsByCategory<S extends { pack: FilterablePack }>(
  sections: readonly S[],
  { category, genre }: LibraryFilter,
): S[] {
  const byCategory = sections.filter((s) => classifyPack(s.pack).category === category);
  if (category !== 'stories' || genre === ALL_GENRES) return byCategory;
  return byCategory.filter((s) => (classifyPack(s.pack).genre ?? '') === genre);
}

/**
 * Genre sub-row items (§3): distinct genre values among the REMOTE «Истории»
 * sections — a genre-less pack counts as a value. `null` when fewer than two
 * values are installed (row hidden). Otherwise «Все» first, known genres in
 * GENRE_ORDER, unknown slugs last (alphabetical, raw slug as label).
 */
export function genreRowItems(sections: readonly { pack: FilterablePack }[]): ChipItem[] | null {
  const values = new Set<string>();
  for (const { pack } of sections) {
    if (!isRemoteStories(pack)) continue;
    values.add(classifyPack(pack).genre ?? '');
  }
  if (values.size < 2) return null;
  const known = GENRE_ORDER.filter((g) => values.has(g));
  const unknown = [...values]
    .filter((g) => g !== '' && !(GENRE_ORDER as readonly string[]).includes(g))
    .sort();
  return [
    { key: ALL_GENRES, label: 'Все' },
    ...[...known, ...unknown].map((g) => {
      const { ru, icon } = labelForGenre(g);
      return { key: g, label: ru, icon };
    }),
  ];
}

/** Installed remote packs per category slug (local packs never count — §4.4). */
export function categoryCounts(packs: readonly FilterablePack[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pack of packs) {
    if (pack.origin === 'local') continue;
    const { category } = classifyPack(pack);
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

/**
 * Category chip items: always all six known shelves in CATEGORY_ORDER with
 * their counts (0 when empty). Recorded T45 decision for an UNKNOWN installed
 * category (a pack authored with a slug the app doesn't know yet, e.g.
 * `recipes`): append a chip with the raw slug + generic icon after the six,
 * per §1.2 ("unknown values render with their raw slug and a generic icon").
 * The persisted selection is included the same way even at count 0 so the
 * selected chip is never invisible.
 */
export function categoryChipItems(counts: Record<string, number>, selected?: string): ChipItem[] {
  const items: ChipItem[] = CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORIES[key].ru,
    icon: CATEGORIES[key].icon,
    count: counts[key] ?? 0,
  }));
  const extra = new Set(Object.keys(counts).filter((k) => !(k in CATEGORIES)));
  if (selected && !(selected in CATEGORIES)) extra.add(selected);
  for (const key of [...extra].sort()) {
    const { ru, icon } = labelForCategory(key);
    items.push({ key, label: ru, icon, count: counts[key] ?? 0 });
  }
  return items;
}

export interface OrderableRow {
  orderIdx: number;
  /** ISO calendar date 'YYYY-MM-DD' — lexicographic order == chronological. */
  sourcePublishedAt: string | null;
}

/**
 * Row order within a pack section (§4.3): `news` sorts
 * `sourcePublishedAt DESC NULLS LAST, orderIdx ASC` (string compare is
 * correct for ISO dates); every other category keeps `orderIdx`. Never
 * mutates its input.
 */
export function orderRowsForCategory<R extends OrderableRow>(
  category: string,
  rows: readonly R[],
): R[] {
  const sorted = [...rows];
  if (category !== 'news') return sorted.sort((a, b) => a.orderIdx - b.orderIdx);
  return sorted.sort((a, b) => {
    if (a.sourcePublishedAt !== b.sourcePublishedAt) {
      if (a.sourcePublishedAt === null) return 1;
      if (b.sourcePublishedAt === null) return -1;
      return a.sourcePublishedAt < b.sourcePublishedAt ? 1 : -1;
    }
    return a.orderIdx - b.orderIdx;
  });
}

// T46: the date helpers moved to `lib/ru-date.ts` (the reader header's
// source line shares them); re-exported so T45 callers/tests are unchanged.
export {
  detectRuDatePath,
  formatRuDate,
  formatRuDateFallback,
  type RuDatePath,
} from '@/lib/ru-date';

/**
 * Story row caption (§4.3): `source.name · date` for sourced rows (date part
 * omitted when NULL); fiction rows keep today's `titleEn · N sentences`
 * string byte-for-byte.
 */
export function storyRowCaption(story: {
  titleEn: string;
  sentenceCount: number;
  sourceName: string | null;
  sourcePublishedAt: string | null;
}): string {
  if (story.sourceName) {
    return story.sourcePublishedAt
      ? `${story.sourceName} · ${formatRuDate(story.sourcePublishedAt)}`
      : story.sourceName;
  }
  return `${story.titleEn} · ${story.sentenceCount} sentences`;
}
