import { z } from 'zod';
import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

/**
 * Game-generation settings (T13). Same pattern as lookup-prefs: hydrated
 * once by DbProvider, setters write through to the settings table
 * fire-and-forget. The stored value is Zod-validated on read — a corrupt
 * row silently falls back to the safe default (never spoil).
 */
interface GamePrefsState {
  /**
   * false (default): cloze/sentence-builder sentences come only from stories
   * Mitch has actually read (T04 progress). true: any imported sentence is
   * eligible, unread stories included.
   */
  clozeUnseenStoriesAllowed: boolean;
  setClozeUnseenStoriesAllowed: (value: boolean) => void;
  /**
   * false (default): dialogue choices are voice-first (mic leads, tap
   * unlocks after failed attempts). true: tap-to-choose from the start —
   * for silent environments; the mic stays available either way (T27).
   */
  dialogueTapMode: boolean;
  setDialogueTapMode: (value: boolean) => void;
}

export const useGamePrefs = create<GamePrefsState>((set) => ({
  clozeUnseenStoriesAllowed: false,
  setClozeUnseenStoriesAllowed: (value) => {
    set({ clozeUnseenStoriesAllowed: value });
    track('games_unseen_stories_toggled', { enabled: value });
    void repos.settings.set(SETTING_KEYS.clozeUnseenStoriesAllowed, value);
  },
  dialogueTapMode: false,
  setDialogueTapMode: (value) => {
    set({ dialogueTapMode: value });
    track('dialogue_tap_mode_toggled', { enabled: value });
    void repos.settings.set(SETTING_KEYS.dialogueTapMode, value);
  },
}));

/** Load persisted prefs after the DB is ready (called by DbProvider). */
export async function hydrateGamePrefsFromDb(): Promise<void> {
  const [unseen, tapMode] = await Promise.all([
    repos.settings.get<unknown>(SETTING_KEYS.clozeUnseenStoriesAllowed),
    repos.settings.get<unknown>(SETTING_KEYS.dialogueTapMode),
  ]);
  const parsedUnseen = z.boolean().safeParse(unseen);
  if (parsedUnseen.success) {
    useGamePrefs.setState({ clozeUnseenStoriesAllowed: parsedUnseen.data });
  }
  const parsedTap = z.boolean().safeParse(tapMode);
  if (parsedTap.success) {
    useGamePrefs.setState({ dialogueTapMode: parsedTap.data });
  }
}
