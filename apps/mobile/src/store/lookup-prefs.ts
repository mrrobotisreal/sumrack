import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

/**
 * Word-lookup behavior settings (design §7.1: encounter recorded
 * "automatically on tap-lookup — configurable"). Same pattern as
 * reader-prefs: hydrated once by DbProvider, setters write through to the
 * settings table fire-and-forget.
 */
interface LookupPrefsState {
  /**
   * true (default): tapping a word whose lemma is already banked records a
   * new encounter by itself. false: only an explicit add writes anything.
   */
  encounterOnLookup: boolean;
  setEncounterOnLookup: (value: boolean) => void;
}

export const useLookupPrefs = create<LookupPrefsState>((set) => ({
  encounterOnLookup: true,
  setEncounterOnLookup: (value) => {
    set({ encounterOnLookup: value });
    track('lookup_encounter_toggled', { enabled: value });
    void repos.settings.set(SETTING_KEYS.encounterOnLookup, value);
  },
}));

/** Load persisted prefs after the DB is ready (called by DbProvider). */
export async function hydrateLookupPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<boolean>(SETTING_KEYS.encounterOnLookup);
  if (typeof stored === 'boolean') {
    useLookupPrefs.setState({ encounterOnLookup: stored });
  }
}
