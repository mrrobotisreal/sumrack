import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import {
  DEFAULT_SCENARIO_PREFS,
  parseScenarioPrefs,
  type ScenarioPrefs,
} from './scenario-prefs-core';

/**
 * «Сценарии» run prefs store (T62, SPEAKING_SCENARIOS §4.4): the one accessor
 * over `scenario.prefs`, sanitized through `scenario-prefs-core`. Hydrated once by DbProvider (the
 * ambient-prefs pattern); every setter writes through, serialized, and a
 * malformed stored value heals FIELD-BY-FIELD to the defaults — a bad
 * `bedVolume` never resets `subtitles`.
 */

export type ScenarioPrefPatch = Partial<Omit<ScenarioPrefs, 'v'>>;

interface ScenarioPrefsState {
  prefs: ScenarioPrefs;
  /** Hydrated from the settings table (false until DbProvider finishes). */
  hydrated: boolean;
  setPrefs: (patch: ScenarioPrefPatch) => void;
}

// Serialize writes so rapid slider changes cannot persist out of order.
let pendingWrite = Promise.resolve();

export const useScenarioPrefs = create<ScenarioPrefsState>((set, get) => ({
  prefs: DEFAULT_SCENARIO_PREFS,
  hydrated: false,
  setPrefs(patch) {
    const before = get().prefs;
    const prefs = parseScenarioPrefs({ ...before, ...patch });
    set({ prefs });
    for (const key of Object.keys(patch) as (keyof ScenarioPrefPatch)[]) {
      if (before[key] === prefs[key]) continue;
      if (key === 'subtitles') track('scenario_subtitles_toggled', { enabled: prefs.subtitles });
      else
        track('scenario_pref_changed', {
          key,
          value: typeof prefs[key] === 'number' ? Math.round(prefs[key] * 100) : prefs[key],
        });
    }
    pendingWrite = pendingWrite
      .then(() => repos.settings.set(SETTING_KEYS.scenarioPrefs, prefs))
      .catch((err) => logError('manual', err));
  },
}));

export async function hydrateScenarioPrefsFromDb(): Promise<void> {
  const raw = await repos.settings.get<unknown>(SETTING_KEYS.scenarioPrefs);
  useScenarioPrefs.setState({ prefs: parseScenarioPrefs(raw), hydrated: true });
}

export * from './scenario-prefs-core';
