import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  DEFAULT_AMBIENT_PREFS,
  parseAmbientPrefs,
  type AmbientPrefs,
} from '@/features/ambient-audio/preferences';
import { logError } from '@/services/error-log';

// Serialize writes so rapid changes cannot persist in the wrong order.
let pendingWrite = Promise.resolve();

export const useAmbientPrefs = create<
  AmbientPrefs & {
    setPrefs(patch: Partial<AmbientPrefs>): void;
  }
>((set, get) => ({
  ...DEFAULT_AMBIENT_PREFS,
  setPrefs(patch) {
    const prefs = parseAmbientPrefs({ ...get(), ...patch });
    set(prefs);
    pendingWrite = pendingWrite
      .then(() => repos.settings.set(SETTING_KEYS.ambientAudio, prefs))
      .catch((error) => logError('manual', error));
  },
}));

export async function hydrateAmbientPrefsFromDb(): Promise<void> {
  useAmbientPrefs.setState(parseAmbientPrefs(await repos.settings.get(SETTING_KEYS.ambientAudio)));
}
