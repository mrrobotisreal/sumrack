import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_KEYS } from '@/db/repositories/settings';

import {
  LIBRARY_PREFS_DEFAULTS,
  hydrateLibraryPrefsFromDb,
  sanitize,
  useLibraryPrefs,
} from '../library-prefs';

// vi.mock calls are hoisted above the imports at run time; the store must be
// hoisted with them (the sync/config.test.ts pattern).
const settingsStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/db', () => ({
  repos: {
    settings: {
      get: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        settingsStore.set(key, value);
      }),
    },
  },
}));

const KEY = SETTING_KEYS.libraryFilter;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  settingsStore.clear();
  useLibraryPrefs.setState(LIBRARY_PREFS_DEFAULTS);
});

describe('sanitize', () => {
  it('defaults are { stories, all }', () => {
    expect(LIBRARY_PREFS_DEFAULTS).toEqual({ category: 'stories', genre: 'all' });
    expect(KEY).toBe('library.filter');
  });

  it('well-formed known slugs pass through', () => {
    expect(sanitize({ category: 'news', genre: 'all' })).toEqual({
      category: 'news',
      genre: 'all',
    });
    expect(sanitize({ category: 'stories', genre: 'comedy' })).toEqual({
      category: 'stories',
      genre: 'comedy',
    });
  });

  it('a well-formed UNKNOWN category/genre slug is kept (forward-compatible reading)', () => {
    expect(sanitize({ category: 'recipes', genre: 'soup' })).toEqual({
      category: 'recipes',
      genre: 'soup',
    });
  });

  it('malformed values heal to the defaults, field by field', () => {
    expect(sanitize(null)).toEqual(LIBRARY_PREFS_DEFAULTS);
    expect(sanitize(undefined)).toEqual(LIBRARY_PREFS_DEFAULTS);
    expect(sanitize('news')).toEqual(LIBRARY_PREFS_DEFAULTS);
    expect(sanitize(42)).toEqual(LIBRARY_PREFS_DEFAULTS);
    expect(sanitize({})).toEqual(LIBRARY_PREFS_DEFAULTS);
    expect(sanitize({ category: 7, genre: true })).toEqual(LIBRARY_PREFS_DEFAULTS);
    expect(sanitize({ category: '', genre: '' })).toEqual(LIBRARY_PREFS_DEFAULTS);
    // Not a StableId: uppercase, spaces, leading hyphen, Cyrillic.
    expect(sanitize({ category: 'News', genre: 'all' })).toEqual({
      category: 'stories',
      genre: 'all',
    });
    expect(sanitize({ category: 'news', genre: 'slice of life' })).toEqual({
      category: 'news',
      genre: 'all',
    });
    expect(sanitize({ category: '-news', genre: 'Новости' })).toEqual(LIBRARY_PREFS_DEFAULTS);
    // One bad field does not take the good one down with it.
    expect(sanitize({ category: 'podcast', genre: null })).toEqual({
      category: 'podcast',
      genre: 'all',
    });
    expect(sanitize({ category: undefined, genre: 'horror' })).toEqual({
      category: 'stories',
      genre: 'horror',
    });
  });
});

describe('setters', () => {
  it('setGenre persists the pair under library.filter', async () => {
    useLibraryPrefs.getState().setGenre('comedy');
    await flush();
    expect(useLibraryPrefs.getState().genre).toBe('comedy');
    expect(settingsStore.get(KEY)).toEqual({ category: 'stories', genre: 'comedy' });
  });

  it('setCategory resets the genre to «Все» and persists', async () => {
    useLibraryPrefs.getState().setGenre('comedy');
    useLibraryPrefs.getState().setCategory('news');
    await flush();
    expect(useLibraryPrefs.getState()).toMatchObject({ category: 'news', genre: 'all' });
    expect(settingsStore.get(KEY)).toEqual({ category: 'news', genre: 'all' });
  });

  it('setCategory back to stories also lands on «Все» (no stale genre)', async () => {
    useLibraryPrefs.getState().setGenre('horror');
    useLibraryPrefs.getState().setCategory('travel');
    useLibraryPrefs.getState().setCategory('stories');
    expect(useLibraryPrefs.getState()).toMatchObject({ category: 'stories', genre: 'all' });
  });

  it('setters sanitize their input (a malformed slug lands on the default)', () => {
    useLibraryPrefs.getState().setCategory('Not A Slug');
    expect(useLibraryPrefs.getState().category).toBe('stories');
    useLibraryPrefs.getState().setGenre('');
    expect(useLibraryPrefs.getState().genre).toBe('all');
  });
});

describe('hydrateLibraryPrefsFromDb', () => {
  it('reads the stored JSON into the store', async () => {
    settingsStore.set(KEY, { category: 'podcast', genre: 'all' });
    await hydrateLibraryPrefsFromDb();
    expect(useLibraryPrefs.getState()).toMatchObject({ category: 'podcast', genre: 'all' });
  });

  it('no stored row → defaults (and nothing is written)', async () => {
    useLibraryPrefs.setState({ category: 'news', genre: 'all' });
    await hydrateLibraryPrefsFromDb();
    expect(useLibraryPrefs.getState()).toMatchObject(LIBRARY_PREFS_DEFAULTS);
    expect(settingsStore.has(KEY)).toBe(false);
  });

  it('a corrupt stored row heals to the defaults in memory', async () => {
    settingsStore.set(KEY, { category: ['news'], genre: 12 });
    await hydrateLibraryPrefsFromDb();
    expect(useLibraryPrefs.getState()).toMatchObject(LIBRARY_PREFS_DEFAULTS);
  });

  it('keeps an unknown well-formed category from a newer build', async () => {
    settingsStore.set(KEY, { category: 'recipes', genre: 'all' });
    await hydrateLibraryPrefsFromDb();
    expect(useLibraryPrefs.getState().category).toBe('recipes');
  });
});
