import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_KEYS } from '@/db/repositories/settings';

import { DEFAULT_REPO, getRepoConfig, setRepoConfig } from '../config';

/**
 * T09: the content repo was renamed sumrack-content → sumrak-content on
 * GitHub (2026-08-21). A device that saved its settings before the rename
 * still stores the old name; `getRepoConfig` must heal it in place so sync
 * survives the day the redirect stops working.
 */

// vi.mock calls are hoisted above the imports at run time; the store must be
// hoisted with them.
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

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

beforeEach(() => {
  settingsStore.clear();
});

describe('getRepoConfig legacy-name healing', () => {
  it('rewrites the misspelled sumrack-content to sumrak-content and persists it', async () => {
    settingsStore.set(SETTING_KEYS.contentRepo, {
      owner: 'mrrobotisreal',
      repo: 'sumrack-content',
      branch: 'main',
    });

    const config = await getRepoConfig();
    expect(config).toEqual({ owner: 'mrrobotisreal', repo: 'sumrak-content', branch: 'main' });
    // Healed value was written back, not just returned.
    expect(settingsStore.get(SETTING_KEYS.contentRepo)).toEqual({
      owner: 'mrrobotisreal',
      repo: 'sumrak-content',
      branch: 'main',
    });
  });

  it('leaves a same-named repo under a different owner alone', async () => {
    settingsStore.set(SETTING_KEYS.contentRepo, {
      owner: 'someone-else',
      repo: 'sumrack-content',
    });
    const config = await getRepoConfig();
    expect(config?.repo).toBe('sumrack-content');
  });

  it('passes the correct name through untouched', async () => {
    await setRepoConfig(DEFAULT_REPO);
    const config = await getRepoConfig();
    expect(config).toEqual(DEFAULT_REPO);
  });

  it('still returns null when nothing is stored', async () => {
    expect(await getRepoConfig()).toBeNull();
  });
});
