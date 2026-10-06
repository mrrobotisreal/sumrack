import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  DEFAULT_DAILY_PREFS,
  parseDailyPrefs,
  type DailyPrefs,
  type DailyWeights,
} from '@/features/review/daily/prefs';
import { track } from '@/services/analytics';

/**
 * Daily-session composition settings (T14). Same pattern as game-prefs:
 * hydrated once by DbProvider, setters write through to the settings table
 * fire-and-forget; stored value Zod-validated on read (parseDailyPrefs) so
 * a corrupt row falls back to defaults.
 */
interface DailyPrefsState {
  prefs: DailyPrefs;
  setLength: (length: number) => void;
  setWeight: (key: keyof DailyWeights, value: number) => void;
  /** M18 (T70): force the TORFL segment on/off; `undefined` = auto (follows the exam date). */
  setTorfl: (value: boolean | undefined) => void;
}

function persist(prefs: DailyPrefs, changed: string, value: number) {
  track('daily_prefs_changed', { setting: changed, value });
  void repos.settings.set(SETTING_KEYS.dailySessionPrefs, prefs);
}

export const useDailyPrefs = create<DailyPrefsState>((set, get) => ({
  prefs: DEFAULT_DAILY_PREFS,
  setLength: (length) => {
    const prefs = { ...get().prefs, length };
    set({ prefs });
    persist(prefs, 'length', length);
  },
  setWeight: (key, value) => {
    const current = get().prefs;
    const prefs = { ...current, weights: { ...current.weights, [key]: value } };
    set({ prefs });
    persist(prefs, `weight.${key}`, value);
  },
  setTorfl: (value) => {
    const { torfl: _old, ...rest } = get().prefs;
    const prefs: DailyPrefs = value === undefined ? rest : { ...rest, torfl: value };
    set({ prefs });
    persist(prefs, 'torfl', value === undefined ? -1 : value ? 1 : 0);
  },
}));

/** Load persisted prefs after the DB is ready (called by DbProvider). */
export async function hydrateDailyPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.dailySessionPrefs);
  if (stored != null) {
    useDailyPrefs.setState({ prefs: parseDailyPrefs(stored) });
  }
}
