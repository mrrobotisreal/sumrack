import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALL_GENRES } from '../categories';
import {
  categoryChipItems,
  categoryCounts,
  detectRuDatePath,
  filterSectionsByCategory,
  formatRuDate,
  formatRuDateFallback,
  genreRowItems,
  orderRowsForCategory,
  storyRowCaption,
  type FilterablePack,
  type OrderableRow,
} from '../library-filter';

const pack = (over: Partial<FilterablePack> & { id: string }): FilterablePack => ({
  type: 'stories',
  category: null,
  genre: null,
  origin: 'remote',
  ...over,
});

interface Section {
  pack: FilterablePack;
  data: string[];
}

const section = (over: Partial<FilterablePack> & { id: string }): Section => ({
  pack: pack(over),
  data: [over.id],
});

// The T44 fixture set + the legacy creepypasta shelf, as installed on the S25.
const legacyHorror = section({ id: 'a1-tall-dog-001' }); // no category → stories/horror
const legacyHorrorA2 = section({ id: 'a2-tall-dog-002' });
const dialogue = section({ id: 'a2-dialogue-001', type: 'dialogue' }); // stories/null
const comedy = section({ id: 'a1-comedy-090', category: 'stories', genre: 'comedy' });
const news = section({ id: 'news-090-a2', category: 'news' });
const podcast = section({ id: 'podcast-090-a2', category: 'podcast' });
const recipes = section({ id: 'a2-recipes-001', category: 'recipes' }); // unknown category
const local = section({ id: 'imported-1', origin: 'local' });

const ids = (sections: Section[]) => sections.map((s) => s.pack.id);

describe('filterSectionsByCategory', () => {
  const all = [legacyHorror, comedy, news, dialogue, legacyHorrorA2, podcast];

  it('keeps only the selected category, preserving input order', () => {
    expect(ids(filterSectionsByCategory(all, { category: 'news', genre: ALL_GENRES }))).toEqual([
      'news-090-a2',
    ]);
    expect(ids(filterSectionsByCategory(all, { category: 'podcast', genre: ALL_GENRES }))).toEqual([
      'podcast-090-a2',
    ]);
  });

  it('default-classified legacy packs land in «Истории»', () => {
    expect(ids(filterSectionsByCategory(all, { category: 'stories', genre: ALL_GENRES }))).toEqual([
      'a1-tall-dog-001',
      'a1-comedy-090',
      'a2-dialogue-001',
      'a2-tall-dog-002',
    ]);
  });

  it('genre filter compares `genre ?? ""` — the genre-less dialogue only shows under «Все»', () => {
    expect(ids(filterSectionsByCategory(all, { category: 'stories', genre: 'horror' }))).toEqual([
      'a1-tall-dog-001',
      'a2-tall-dog-002',
    ]);
    expect(ids(filterSectionsByCategory(all, { category: 'stories', genre: 'comedy' }))).toEqual([
      'a1-comedy-090',
    ]);
    expect(filterSectionsByCategory(all, { category: 'stories', genre: 'drama' })).toEqual([]);
  });

  it('ignores the genre outside «Истории» (a genre on a news pack is meaningless)', () => {
    const genreNews = section({ id: 'news-x', category: 'news', genre: 'horror' });
    expect(
      ids(filterSectionsByCategory([genreNews, news], { category: 'news', genre: 'comedy' })),
    ).toEqual(['news-x', 'news-090-a2']);
  });

  it('an empty category yields an empty list (the «Пока пусто» state)', () => {
    expect(filterSectionsByCategory(all, { category: 'travel', genre: ALL_GENRES })).toEqual([]);
  });

  it('unknown installed category is filterable by its raw slug', () => {
    expect(
      ids(filterSectionsByCategory([...all, recipes], { category: 'recipes', genre: ALL_GENRES })),
    ).toEqual(['a2-recipes-001']);
  });

  it('filter-before-group: a rung authored into another category simply leaves the shelf', () => {
    // Same family tag, but the B1 rung was authored as `news` (impossible in
    // practice — the rule "a family's category is its lowest rung's" holds
    // because the foreign rung never reaches groupByFamily).
    const foreignRung = section({ id: 'b1-tall-dog-003', category: 'news' });
    expect(
      ids(
        filterSectionsByCategory([legacyHorror, legacyHorrorA2, foreignRung], {
          category: 'stories',
          genre: ALL_GENRES,
        }),
      ),
    ).toEqual(['a1-tall-dog-001', 'a2-tall-dog-002']);
  });
});

describe('genreRowItems — the ≥2-distinct-values rule (§3)', () => {
  it('hides the row with a single genre value', () => {
    expect(genreRowItems([legacyHorror, legacyHorrorA2])).toBeNull();
    expect(genreRowItems([comedy])).toBeNull();
    expect(genreRowItems([])).toBeNull();
  });

  it('a genre-less pack counts as a value: horror + dialogue → «Все · Страшилки»', () => {
    expect(genreRowItems([legacyHorror, dialogue])).toEqual([
      { key: ALL_GENRES, label: 'Все' },
      { key: 'horror', label: 'Страшилки', icon: 'skull-outline' },
    ]);
  });

  it('horror + comedy + dialogue → «Все · Страшилки · Комедия» in GENRE_ORDER', () => {
    expect(genreRowItems([comedy, dialogue, legacyHorror, legacyHorrorA2])).toEqual([
      { key: ALL_GENRES, label: 'Все' },
      { key: 'horror', label: 'Страшилки', icon: 'skull-outline' },
      { key: 'comedy', label: 'Комедия', icon: 'happy-outline' },
    ]);
  });

  it('only counts remote «Истории» sections — news, podcasts and local packs never add a value', () => {
    expect(genreRowItems([legacyHorror, news, podcast, local])).toBeNull();
  });

  it('unknown genre slugs sort last with their raw slug as the label', () => {
    const weird = section({ id: 'x', category: 'stories', genre: 'zz-unknown' });
    const items = genreRowItems([weird, comedy, legacyHorror]);
    expect(items?.map((i) => i.key)).toEqual([ALL_GENRES, 'horror', 'comedy', 'zz-unknown']);
    expect(items?.[3]).toEqual({
      key: 'zz-unknown',
      label: 'zz-unknown',
      icon: 'pricetag-outline',
    });
  });

  it('two unknown slugs keep a stable (alphabetical) order after the known ones', () => {
    const b = section({ id: 'b', category: 'stories', genre: 'beta' });
    const a = section({ id: 'a', category: 'stories', genre: 'alpha' });
    expect(genreRowItems([b, a, comedy])?.map((i) => i.key)).toEqual([
      ALL_GENRES,
      'comedy',
      'alpha',
      'beta',
    ]);
  });
});

describe('categoryCounts', () => {
  it('counts remote packs per category slug and ignores local (imported) packs', () => {
    const counts = categoryCounts([
      legacyHorror.pack,
      legacyHorrorA2.pack,
      comedy.pack,
      dialogue.pack,
      news.pack,
      podcast.pack,
      local.pack,
      recipes.pack,
    ]);
    expect(counts).toEqual({ stories: 4, news: 1, podcast: 1, recipes: 1 });
  });

  it('empty input → no keys', () => {
    expect(categoryCounts([])).toEqual({});
  });
});

describe('categoryChipItems — six known chips always, unknown installed categories appended', () => {
  it('renders all six known categories with counts (0 when nothing is installed)', () => {
    const items = categoryChipItems({ stories: 22, news: 1, podcast: 1 });
    expect(items.map((i) => i.key)).toEqual([
      'stories',
      'news',
      'education',
      'podcast',
      'documentary',
      'travel',
    ]);
    expect(items.map((i) => i.count)).toEqual([22, 1, 0, 1, 0, 0]);
    expect(items[0]).toEqual({ key: 'stories', label: 'Истории', icon: 'book-outline', count: 22 });
  });

  it('adds a seventh chip for an unknown installed category with its raw slug + generic icon', () => {
    const items = categoryChipItems({ recipes: 1, stories: 3 });
    expect(items.map((i) => i.key)).toEqual([
      'stories',
      'news',
      'education',
      'podcast',
      'documentary',
      'travel',
      'recipes',
    ]);
    expect(items[6]).toEqual({
      key: 'recipes',
      label: 'recipes',
      icon: 'albums-outline',
      count: 1,
    });
  });

  it('a persisted unknown category with zero installed packs still gets a chip (so the selection is visible)', () => {
    const items = categoryChipItems({}, 'recipes');
    expect(items.at(-1)).toEqual({
      key: 'recipes',
      label: 'recipes',
      icon: 'albums-outline',
      count: 0,
    });
  });
});

describe('orderRowsForCategory', () => {
  const row = (
    id: string,
    orderIdx: number,
    sourcePublishedAt: string | null,
  ): OrderableRow & { id: string } => ({ id, orderIdx, sourcePublishedAt });
  const rows = [
    row('first-snow-old', 0, '2026-09-10'), // article 1 (fixture shape)
    row('first-snow', 1, '2026-09-14'), // article 2 — newest → first
    row('undated', 2, null),
    row('same-day-b', 3, '2026-09-14'),
  ];

  it('news: sourcePublishedAt DESC NULLS LAST, orderIdx ASC tiebreak', () => {
    expect(orderRowsForCategory('news', rows).map((r) => r.id)).toEqual([
      'first-snow',
      'same-day-b',
      'first-snow-old',
      'undated',
    ]);
  });

  it('news: does not mutate the input', () => {
    const copy = [...rows];
    orderRowsForCategory('news', rows);
    expect(rows).toEqual(copy);
  });

  it('every other category keeps orderIdx', () => {
    const shuffled = [rows[1]!, rows[3]!, rows[0]!, rows[2]!];
    for (const category of ['stories', 'podcast', 'education', 'recipes']) {
      expect(orderRowsForCategory(category, shuffled).map((r) => r.id)).toEqual([
        'first-snow-old',
        'first-snow',
        'undated',
        'same-day-b',
      ]);
    }
  });
});

describe('storyRowCaption (§4.3)', () => {
  const fiction = {
    titleEn: 'The Tall Dog',
    sentenceCount: 12,
    sourceName: null,
    sourcePublishedAt: null,
  };

  it('fiction rows keep the exact pre-T45 caption', () => {
    expect(storyRowCaption(fiction)).toBe('The Tall Dog · 12 sentences');
  });

  it('sourced rows render `source · date`', () => {
    expect(
      storyRowCaption({ ...fiction, sourceName: 'Сумрак-тест', sourcePublishedAt: '2026-09-14' }),
    ).toBe('Сумрак-тест · 14 сент. 2026');
  });

  it('sourced rows without a date omit the date part (no dangling separator)', () => {
    expect(storyRowCaption({ ...fiction, sourceName: 'Сумрак' })).toBe('Сумрак');
  });
});

describe('formatRuDate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fallback table: genitive short months, «мая» and «сент.» spelled per the design', () => {
    expect(formatRuDateFallback('2026-09-14')).toBe('14 сент. 2026');
    expect(formatRuDateFallback('2026-09-10')).toBe('10 сент. 2026');
    expect(formatRuDateFallback('2026-09-01')).toBe('1 сент. 2026');
    expect(formatRuDateFallback('2026-05-09')).toBe('9 мая 2026');
    expect(formatRuDateFallback('2026-01-31')).toBe('31 янв. 2026');
    expect(formatRuDateFallback('2026-12-25')).toBe('25 дек. 2026');
  });

  it('fallback table: every month has an entry', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      formatRuDateFallback(`2026-${String(i + 1).padStart(2, '0')}-05`),
    );
    expect(months).toEqual([
      '5 янв. 2026',
      '5 февр. 2026',
      '5 мар. 2026',
      '5 апр. 2026',
      '5 мая 2026',
      '5 июн. 2026',
      '5 июл. 2026',
      '5 авг. 2026',
      '5 сент. 2026',
      '5 окт. 2026',
      '5 нояб. 2026',
      '5 дек. 2026',
    ]);
  });

  it('malformed input is returned as-is (never throws on a hand-staged row)', () => {
    expect(formatRuDateFallback('not-a-date')).toBe('not-a-date');
    expect(formatRuDateFallback('2026-13-01')).toBe('2026-13-01');
    expect(formatRuDate('')).toBe('');
  });

  it('Intl path: used when the runtime produces Cyrillic output', () => {
    // Node ships full ICU, so this exercises the real Intl branch.
    expect(detectRuDatePath()).toBe('intl');
    // ICU's « г.» suffix is stripped so both paths yield the same string.
    expect(formatRuDate('2026-09-14')).toBe('14 сент. 2026');
    expect(formatRuDate('2026-05-09')).toBe('9 мая 2026');
    expect(formatRuDate('2026-09-14')).toBe(formatRuDateFallback('2026-09-14'));
  });

  it('falls back to the table when Intl output has no Cyrillic (Hermes with no ru-RU data)', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ format: () => 'Sep 14, 2026' }) as unknown as Intl.DateTimeFormat,
    );
    expect(formatRuDate('2026-09-14')).toBe('14 сент. 2026');
  });

  it('falls back to the table when Intl throws (RangeError on an unsupported locale)', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('Incorrect locale information provided');
    });
    expect(formatRuDate('2026-09-14')).toBe('14 сент. 2026');
  });

  it('detectRuDatePath reports the fallback when Intl yields numerals only', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () => ({ format: () => '9/14/2026' }) as unknown as Intl.DateTimeFormat,
    );
    expect(detectRuDatePath()).toBe('fallback');
    expect(formatRuDate('2026-09-14')).toBe('14 сент. 2026');
  });
});
