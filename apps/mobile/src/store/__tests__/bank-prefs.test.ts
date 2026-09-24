import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BANK_SORT } from '@/db/repositories/bank';
import { SETTING_KEYS } from '@/db/repositories/settings';

import { hydrateBankPrefsFromDb, isDefaultBankSort, sanitize, useBankPrefs } from '../bank-prefs';

// vi.mock calls are hoisted above the imports at run time; the store must be
// hoisted with them (the library-prefs.test.ts pattern).
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

const KEY = SETTING_KEYS.bankSort;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  settingsStore.clear();
  useBankPrefs.setState({ sort: DEFAULT_BANK_SORT });
});

describe('sanitize (T50)', () => {
  it('defaults are { added-asc, least } under bank.sort', () => {
    expect(DEFAULT_BANK_SORT).toEqual({ key: 'added-asc', familiarity: 'least' });
    expect(KEY).toBe('bank.sort');
  });

  it('every known key + familiarity passes through', () => {
    for (const key of [
      'added-asc',
      'added-desc',
      'alpha-asc',
      'alpha-desc',
      'unpracticed-first',
      'practiced-first',
    ] as const) {
      expect(sanitize({ v: 1, key, familiarity: 'most' })).toEqual({ key, familiarity: 'most' });
    }
  });

  it('unknown key → default key; unknown familiarity → least; field by field', () => {
    expect(sanitize({ key: 'by-mood', familiarity: 'most' })).toEqual({
      key: 'added-asc',
      familiarity: 'most',
    });
    expect(sanitize({ key: 'alpha-desc', familiarity: 'middling' })).toEqual({
      key: 'alpha-desc',
      familiarity: 'least',
    });
  });

  it('malformed values heal to the defaults', () => {
    expect(sanitize(null)).toEqual(DEFAULT_BANK_SORT);
    expect(sanitize(undefined)).toEqual(DEFAULT_BANK_SORT);
    expect(sanitize('alpha-asc')).toEqual(DEFAULT_BANK_SORT);
    expect(sanitize(42)).toEqual(DEFAULT_BANK_SORT);
    expect(sanitize({})).toEqual(DEFAULT_BANK_SORT);
    expect(sanitize({ key: 7, familiarity: true })).toEqual(DEFAULT_BANK_SORT);
    expect(sanitize({ key: ['alpha-asc'], familiarity: null })).toEqual(DEFAULT_BANK_SORT);
  });

  it('isDefaultBankSort looks at the key only (familiarity is remembered, not shown)', () => {
    expect(isDefaultBankSort({ key: 'added-asc', familiarity: 'most' })).toBe(true);
    expect(isDefaultBankSort({ key: 'added-desc', familiarity: 'least' })).toBe(false);
  });
});

describe('setSort', () => {
  it('merges a partial patch, sanitizes it, and persists { v: 1, key, familiarity }', async () => {
    useBankPrefs.getState().setSort({ key: 'practiced-first' });
    await flush();
    expect(useBankPrefs.getState().sort).toEqual({ key: 'practiced-first', familiarity: 'least' });
    expect(settingsStore.get(KEY)).toEqual({ v: 1, key: 'practiced-first', familiarity: 'least' });

    useBankPrefs.getState().setSort({ familiarity: 'most' });
    await flush();
    expect(useBankPrefs.getState().sort).toEqual({ key: 'practiced-first', familiarity: 'most' });
    expect(settingsStore.get(KEY)).toEqual({ v: 1, key: 'practiced-first', familiarity: 'most' });
  });

  it('a malformed patch lands on the defaults for that field', () => {
    useBankPrefs.getState().setSort({ key: 'alpha-asc' });
    useBankPrefs.getState().setSort({ key: 'nope' as never });
    expect(useBankPrefs.getState().sort.key).toBe('added-asc');
  });
});

describe('hydrateBankPrefsFromDb', () => {
  it('reads the stored JSON into the store', async () => {
    settingsStore.set(KEY, { v: 1, key: 'alpha-desc', familiarity: 'most' });
    await hydrateBankPrefsFromDb();
    expect(useBankPrefs.getState().sort).toEqual({ key: 'alpha-desc', familiarity: 'most' });
  });

  it('no stored row → defaults (and nothing is written)', async () => {
    useBankPrefs.setState({ sort: { key: 'added-desc', familiarity: 'least' } });
    await hydrateBankPrefsFromDb();
    expect(useBankPrefs.getState().sort).toEqual(DEFAULT_BANK_SORT);
    expect(settingsStore.has(KEY)).toBe(false);
  });

  it('a corrupt stored row heals to the defaults in memory', async () => {
    settingsStore.set(KEY, { key: ['alpha-asc'], familiarity: 12 });
    await hydrateBankPrefsFromDb();
    expect(useBankPrefs.getState().sort).toEqual(DEFAULT_BANK_SORT);
  });
});
