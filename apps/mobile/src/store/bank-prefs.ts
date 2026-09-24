import { create } from 'zustand';
import { z } from 'zod';

import { repos } from '@/db';
import {
  BANK_SORT_KEYS,
  DEFAULT_BANK_SORT,
  type BankSort,
  type BankSortKey,
  type FamiliaritySort,
} from '@/db/repositories/bank';
import { SETTING_KEYS } from '@/db/repositories/settings';

/**
 * Словарь sort (T50, WORD_FORMS §2.4/§3.3) — the library-prefs.ts pattern:
 * DbProvider hydrates once after migrations (and restore-service re-hydrates
 * after a restore), `setSort` writes through fire-and-forget under
 * SETTING_KEYS.bankSort as `{ v: 1, key, familiarity }`. The familiarity
 * sub-sort is stored even when the key ignores it so it is remembered.
 */
interface BankPrefsState {
  sort: BankSort;
  setSort: (sort: Partial<BankSort>) => void;
}

const KeySchema = z.enum(BANK_SORT_KEYS as [BankSortKey, ...BankSortKey[]]);
const FamiliaritySchema = z.enum(['least', 'most'] satisfies FamiliaritySort[]);

/**
 * Stored-shape guard, field by field: an unknown/malformed key heals to the
 * default key, an unknown/malformed familiarity to 'least', and a non-object
 * to the defaults — the other field survives either way.
 */
export function sanitize(raw: unknown): BankSort {
  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const key = KeySchema.safeParse(obj.key);
  const familiarity = FamiliaritySchema.safeParse(obj.familiarity);
  return {
    key: key.success ? key.data : DEFAULT_BANK_SORT.key,
    familiarity: familiarity.success ? familiarity.data : DEFAULT_BANK_SORT.familiarity,
  };
}

export function isDefaultBankSort(sort: BankSort): boolean {
  return sort.key === DEFAULT_BANK_SORT.key;
}

export const useBankPrefs = create<BankPrefsState>((set, get) => ({
  sort: DEFAULT_BANK_SORT,
  setSort: (patch) => {
    const sort = sanitize({ ...get().sort, ...patch });
    set({ sort });
    void repos.settings.set(SETTING_KEYS.bankSort, { v: 1, ...sort });
  },
}));

/** Load the persisted sort after the DB is ready (DbProvider + post-restore). */
export async function hydrateBankPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.bankSort);
  // No row yet → keep the defaults untouched (a first run has nothing to heal).
  if (stored === null || stored === undefined) {
    useBankPrefs.setState({ sort: DEFAULT_BANK_SORT });
    return;
  }
  useBankPrefs.setState({ sort: sanitize(stored) });
}
