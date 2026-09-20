import { describe, expect, it } from 'vitest';

import {
  ALL_GENRES,
  CATEGORIES,
  CATEGORY_ORDER,
  GENRES,
  GENRE_ORDER,
  REGISTER_LABELS,
  categoryOf,
  classifyPack,
  genreOf,
  isKnownCategory,
  isKnownGenre,
  labelForCategory,
  labelForGenre,
} from '../categories';

type Input = Parameters<typeof classifyPack>[0];

const pack = (over: Partial<Input> = {}): Input => ({
  type: 'stories',
  category: null,
  genre: null,
  origin: 'remote',
  ...over,
});

/** LIBRARY_CATEGORIES §2.4 — THE default table, one row per case. */
describe('classifyPack — the §2.4 default table', () => {
  it('explicit category + genre → as authored', () => {
    expect(classifyPack(pack({ category: 'stories', genre: 'comedy' }))).toEqual({
      category: 'stories',
      genre: 'comedy',
    });
  });

  it('explicit category without genre → genre null (news/podcast fixtures)', () => {
    expect(classifyPack(pack({ category: 'news' }))).toEqual({ category: 'news', genre: null });
    expect(classifyPack(pack({ category: 'podcast' }))).toEqual({
      category: 'podcast',
      genre: null,
    });
  });

  it('explicit category wins over every default, incl. on dialogues and local packs', () => {
    expect(classifyPack(pack({ type: 'dialogue', category: 'education' }))).toEqual({
      category: 'education',
      genre: null,
    });
    expect(classifyPack(pack({ origin: 'local', category: 'travel', genre: 'x' }))).toEqual({
      category: 'travel',
      genre: 'x',
    });
  });

  it('an unknown authored category/genre is kept verbatim (forward-compatible)', () => {
    expect(classifyPack(pack({ category: 'recipes', genre: 'soup' }))).toEqual({
      category: 'recipes',
      genre: 'soup',
    });
  });

  it('none; type stories → stories/horror (the 21 published packs)', () => {
    expect(classifyPack(pack({ type: 'stories' }))).toEqual({
      category: 'stories',
      genre: 'horror',
    });
  });

  it('none; type course-unit → stories/horror', () => {
    expect(classifyPack(pack({ type: 'course-unit' }))).toEqual({
      category: 'stories',
      genre: 'horror',
    });
  });

  it('none; other legacy types (checkpoint/prompts) → stories/horror', () => {
    expect(classifyPack(pack({ type: 'checkpoint' }))).toEqual({
      category: 'stories',
      genre: 'horror',
    });
    expect(classifyPack(pack({ type: 'prompts' }))).toEqual({
      category: 'stories',
      genre: 'horror',
    });
  });

  it('none; type stories with an authored genre only → stories/<genre>', () => {
    expect(classifyPack(pack({ genre: 'romance' }))).toEqual({
      category: 'stories',
      genre: 'romance',
    });
  });

  it('none; type dialogue → stories/null (genre-less unless authored)', () => {
    expect(classifyPack(pack({ type: 'dialogue' }))).toEqual({ category: 'stories', genre: null });
  });

  it('dialogue with an authored genre keeps it', () => {
    expect(classifyPack(pack({ type: 'dialogue', genre: 'family' }))).toEqual({
      category: 'stories',
      genre: 'family',
    });
  });

  it("origin 'local' (Share-to-Сумрак paste, type stories) → stories/null", () => {
    expect(classifyPack(pack({ origin: 'local' }))).toEqual({ category: 'stories', genre: null });
    // A local pack with an authored genre still keeps it (nothing is dropped).
    expect(classifyPack(pack({ origin: 'local', genre: 'absurd' }))).toEqual({
      category: 'stories',
      genre: 'absurd',
    });
  });

  it('empty-string category/genre count as absent', () => {
    expect(classifyPack(pack({ category: '', genre: '' }))).toEqual({
      category: 'stories',
      genre: 'horror',
    });
  });

  it('categoryOf / genreOf are projections of classifyPack', () => {
    const p = pack({ type: 'dialogue' });
    expect(categoryOf(p)).toBe('stories');
    expect(genreOf(p)).toBeNull();
    expect(categoryOf(pack({ category: 'news' }))).toBe('news');
    expect(genreOf(pack({ category: 'stories', genre: 'comedy' }))).toBe('comedy');
  });
});

describe('labels', () => {
  it('known category → table entry', () => {
    expect(labelForCategory('news')).toEqual({
      ru: 'Новости',
      en: 'News',
      icon: 'newspaper-outline',
    });
    expect(labelForCategory('stories')).toBe(CATEGORIES.stories);
  });

  it('unknown category → raw slug + albums-outline', () => {
    expect(labelForCategory('recipes')).toEqual({
      ru: 'recipes',
      en: 'recipes',
      icon: 'albums-outline',
    });
  });

  it('known genre → table entry', () => {
    expect(labelForGenre('horror')).toEqual({
      ru: 'Страшилки',
      en: 'Horror',
      icon: 'skull-outline',
    });
    expect(labelForGenre('slice-of-life')).toBe(GENRES['slice-of-life']);
  });

  it('unknown genre → raw slug + pricetag-outline', () => {
    expect(labelForGenre('soup')).toEqual({ ru: 'soup', en: 'soup', icon: 'pricetag-outline' });
  });

  it('never resolves prototype keys as known slugs', () => {
    expect(isKnownCategory('constructor')).toBe(false);
    expect(isKnownGenre('toString')).toBe(false);
    expect(labelForCategory('__proto__').icon).toBe('albums-outline');
  });
});

describe('sets & order', () => {
  it('isKnownCategory matches exactly the six slugs', () => {
    for (const slug of CATEGORY_ORDER) expect(isKnownCategory(slug)).toBe(true);
    expect(isKnownCategory('all')).toBe(false);
    expect(isKnownCategory('horror')).toBe(false);
    expect(isKnownCategory('')).toBe(false);
  });

  it('CATEGORY_ORDER is exactly the table keys in the §3 chip order', () => {
    expect([...CATEGORY_ORDER]).toEqual([
      'stories',
      'news',
      'education',
      'podcast',
      'documentary',
      'travel',
    ]);
    expect(new Set(CATEGORY_ORDER)).toEqual(new Set(Object.keys(CATEGORIES)));
  });

  it('GENRE_ORDER is exactly the table keys, horror first', () => {
    expect(GENRE_ORDER[0]).toBe('horror');
    expect(new Set(GENRE_ORDER)).toEqual(new Set(Object.keys(GENRES)));
    expect(new Set(GENRE_ORDER).size).toBe(GENRE_ORDER.length);
  });

  it("ALL_GENRES is 'all' and is not a genre", () => {
    expect(ALL_GENRES).toBe('all');
    expect(isKnownGenre(ALL_GENRES)).toBe(false);
  });

  it('REGISTER_LABELS covers the six §2.5 registers', () => {
    expect(REGISTER_LABELS).toEqual({
      narrator: 'Рассказчик',
      anchor: 'Диктор',
      lecturer: 'Лектор',
      host: 'Ведущий',
      voiceover: 'Закадровый голос',
      guide: 'Гид',
    });
  });
});
