import { useReducedMotion } from 'react-native-reanimated';
import { z } from 'zod';
import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

/**
 * Motion settings (T31). Same pattern as game-prefs: hydrated once by
 * DbProvider, setter writes through to the settings table fire-and-forget,
 * stored value Zod-validated on read (corrupt row heals to default).
 */
interface MotionPrefsState {
  /**
   * false (default): ambient room scenes, the threshold transition, and the
   * house-map flicker animate. true: everything holds its static poster
   * frame. The EFFECTIVE flag is this OR the OS reduced-motion setting —
   * always read it through useReduceMotion(), never this field directly.
   */
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
}

export const useMotionPrefs = create<MotionPrefsState>((set) => ({
  reduceMotion: false,
  setReduceMotion: (value) => {
    set({ reduceMotion: value });
    track('reduce_motion_toggled', { enabled: value });
    void repos.settings.set(SETTING_KEYS.reduceMotion, value);
  },
}));

/**
 * The one true reduce-motion flag: app setting OR the OS accessibility
 * setting (reanimated's useReducedMotion). Every ambient animation in the
 * app must consult this hook — not the OS flag alone (T31).
 */
export function useReduceMotion(): boolean {
  const app = useMotionPrefs((s) => s.reduceMotion);
  const os = useReducedMotion();
  return app || os;
}

/** Load persisted prefs after the DB is ready (called by DbProvider). */
export async function hydrateMotionPrefsFromDb(): Promise<void> {
  const raw = await repos.settings.get<unknown>(SETTING_KEYS.reduceMotion);
  const parsed = z.boolean().safeParse(raw);
  if (parsed.success) {
    useMotionPrefs.setState({ reduceMotion: parsed.data });
  }
}
