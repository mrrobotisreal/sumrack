import { describe, expect, it } from 'vitest';

import {
  chapterLabel,
  groupBySeries,
  parseSeriesTags,
  seriesBookTitle,
} from '../series';

const tags = (book: number, chapter: number) => [
  'scifi',
  'series:three-body',
  `book:${book}`,
  `chapter:${chapter}`,
  'family:three-body-ch01',
];

describe('parseSeriesTags', () => {
  it('reads all three tags', () => {
    expect(parseSeriesTags(tags(2, 4))).toEqual({ series: 'three-body', book: 2, chapter: 4 });
  });

  it('is null when any one tag is missing', () => {
    expect(parseSeriesTags(['series:three-body', 'book:1'])).toBeNull();
    expect(parseSeriesTags(['series:three-body', 'chapter:1'])).toBeNull();
    expect(parseSeriesTags(['book:1', 'chapter:1'])).toBeNull();
  });

  it('treats each malformed tag as untagged', () => {
    expect(parseSeriesTags(['series:Three-Body', 'book:1', 'chapter:1'])).toBeNull();
    expect(parseSeriesTags(['series:three-body', 'book:0', 'chapter:1'])).toBeNull();
    expect(parseSeriesTags(['series:three-body', 'book:01', 'chapter:1'])).toBeNull();
    expect(parseSeriesTags(['series:three-body', 'book:1', 'chapter:x'])).toBeNull();
    expect(parseSeriesTags(['series:', 'book:1', 'chapter:1'])).toBeNull();
    expect(parseSeriesTags(['series:three-body', 'book:1', 'chapter:1 '])).toBeNull();
  });

  it('returns null for untagged packs', () => {
    expect(parseSeriesTags(['creepypasta', 'horror'])).toBeNull();
  });
});

describe('seriesBookTitle', () => {
  it('uses the registry title and subtitle when known', () => {
    expect(seriesBookTitle('three-body', 2, 'anything')).toEqual({
      title: 'Задача трёх тел 2',
      subtitle: 'Три тела',
    });
    expect(seriesBookTitle('three-body', 3, 'anything')).toEqual({ title: 'Задача трёх тел 3' });
  });

  it('falls back to the first member prefix with the trailing number stripped', () => {
    expect(seriesBookTitle('mystery', 4, 'Мистерия 2 — Глава 1. Старт')).toEqual({
      title: 'Мистерия 4',
    });
  });

  it('falls back to the whole title when there is no dash', () => {
    expect(seriesBookTitle('mystery', 1, 'Загадка')).toEqual({ title: 'Загадка 1' });
  });
});

describe('chapterLabel', () => {
  it('returns the part after the dash', () => {
    expect(chapterLabel('Задача трёх тел 2 — Глава 4. Границы науки')).toBe(
      'Глава 4. Границы науки',
    );
  });

  it('returns the full title when there is no dash', () => {
    expect(chapterLabel('Глава без тире')).toBe('Глава без тире');
  });
});

describe('groupBySeries', () => {
  type Item = { id: string; tags: string[] };
  const get = (i: Item) => i.tags;
  const item = (id: string, book: number, chapter: number): Item => ({ id, tags: tags(book, chapter) });

  it('orders chapters by number inside a book, and keeps untagged rows in place', () => {
    const items: Item[] = [
      { id: 'plain-a', tags: ['creepypasta'] },
      item('a2-ch05', 2, 5),
      item('a2-ch04', 2, 4),
      { id: 'plain-b', tags: [] },
    ];
    const out = groupBySeries(items, get);
    expect(out.map((r) => (r.kind === 'plain' ? r.item.id : `book${r.book}`))).toEqual([
      'plain-a',
      'book2',
      'plain-b',
    ]);
    const book2 = out[1];
    if (book2?.kind !== 'book') throw new Error('expected book');
    expect(book2.chapters.map((c) => [c.chapter, c.item.id])).toEqual([
      [4, 'a2-ch04'],
      [5, 'a2-ch05'],
    ]);
  });

  it('fills book slots, at first-member positions, with books in number order', () => {
    const out = groupBySeries([item('b2', 2, 4), { id: 'p', tags: [] }, item('b1', 1, 1)], get);
    expect(out.map((r) => (r.kind === 'book' ? r.book : r.item.id))).toEqual([1, 'p', 2]);
  });

  it('keeps a one-chapter book as a book', () => {
    const out = groupBySeries([item('only', 1, 1)], get);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('book');
  });

  it('keeps the first of a duplicated (book, chapter)', () => {
    const out = groupBySeries([item('first', 2, 4), item('second', 2, 4)], get);
    expect(out[0]?.kind === 'book' && out[0].chapters.map((c) => c.item.id)).toEqual(['first']);
  });

  it('passes untagged and malformed packs through as plain rows', () => {
    const out = groupBySeries(
      [{ id: 'x', tags: ['series:three-body', 'book:1'] }],
      get,
    );
    expect(out).toEqual([{ kind: 'plain', item: { id: 'x', tags: ['series:three-body', 'book:1'] } }]);
  });
});
