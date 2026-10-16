import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_KEYS } from '@/db/repositories/settings';

import { hydrateLibraryExpansionFromDb, useLibraryExpansion } from '../library-expansion';

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

const KEY = SETTING_KEYS.libraryExpanded;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  settingsStore.clear();
  useLibraryExpansion.setState({ keys: [] });
});

describe('library expansion store', () => {
  it('uses the library.expanded settings key', () => {
    expect(KEY).toBe('library.expanded');
  });

  it('starts with every section collapsed and no stored row', async () => {
    await hydrateLibraryExpansionFromDb();
    expect(useLibraryExpansion.getState().keys).toEqual([]);
  });

  it('toggle updates state and persists { v: 1, keys }', async () => {
    useLibraryExpansion.getState().toggle('pack:a', true);
    useLibraryExpansion.getState().toggle('pack:b', true);
    useLibraryExpansion.getState().toggle('pack:a', false);
    await flush();
    expect(useLibraryExpansion.getState().keys).toEqual(['pack:b']);
    expect(settingsStore.get(KEY)).toEqual({ v: 1, keys: ['pack:b'] });
  });

  it('setAll replaces the keys and persists them', async () => {
    useLibraryExpansion.getState().setAll(['family:x', 'pack:y']);
    await flush();
    expect(useLibraryExpansion.getState().keys).toEqual(['family:x', 'pack:y']);
    expect(settingsStore.get(KEY)).toEqual({ v: 1, keys: ['family:x', 'pack:y'] });
  });

  it('hydrate restores a stored row through the sanitizer', async () => {
    settingsStore.set(KEY, { v: 1, keys: ['series:three-body:book:2', 'pack:a'] });
    await hydrateLibraryExpansionFromDb();
    expect(useLibraryExpansion.getState().keys).toEqual(['series:three-body:book:2', 'pack:a']);
  });

  it('hydrate heals a malformed row to empty', async () => {
    settingsStore.set(KEY, { v: 9, keys: 'nope' });
    useLibraryExpansion.setState({ keys: ['pack:stale'] });
    await hydrateLibraryExpansionFromDb();
    expect(useLibraryExpansion.getState().keys).toEqual([]);
  });
});
