import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { create } from 'zustand';

import { DEFAULT_AMBIENT_THEME, type AmbientThemeId } from './beds';

/**
 * `activities` is insertion-ordered (a re-registration on focus regain
 * re-inserts at the end), so the most recent study surface decides the theme.
 */
export const useAmbientActivity = create<{
  activities: ReadonlyMap<symbol, AmbientThemeId | undefined>;
  blockers: ReadonlySet<symbol>;
  narrations: ReadonlySet<symbol>;
}>(() => ({ activities: new Map(), blockers: new Set(), narrations: new Set() }));

/**
 * The theme to play (design §7): the last registered activity's theme; a
 * surface that registers without one (games, review) means the default —
 * so a game over a still-mounted news article plays horror while focused.
 */
export function effectiveTheme(
  activities: ReadonlyMap<symbol, AmbientThemeId | undefined>,
): AmbientThemeId {
  let theme: AmbientThemeId | undefined;
  for (const value of activities.values()) theme = value;
  return theme ?? DEFAULT_AMBIENT_THEME;
}

function useBlockerRegistration(enabled: boolean) {
  useFocusEffect(
    React.useCallback(() => {
      if (!enabled) return;
      const id = Symbol('blocker');
      useAmbientActivity.setState((s) => ({ blockers: new Set(s.blockers).add(id) }));
      return () => {
        useAmbientActivity.setState((s) => {
          const blockers = new Set(s.blockers);
          blockers.delete(id);
          return { blockers };
        });
      };
    }, [enabled]),
  );
}

/**
 * Focus cleanup also covers a still-mounted reader underneath a modal/game.
 * `theme` is what this surface wants to hear (the reader passes
 * `resolveAmbientTheme(cls)`); omitted → the default theme.
 */
export function useStudyAmbience(active = true, theme?: AmbientThemeId) {
  useFocusEffect(
    React.useCallback(() => {
      if (!active) return;
      const id = Symbol('activity');
      useAmbientActivity.setState((s) => ({ activities: new Map(s.activities).set(id, theme) }));
      return () => {
        useAmbientActivity.setState((s) => {
          const activities = new Map(s.activities);
          activities.delete(id);
          return { activities };
        });
      };
    }, [active, theme]),
  );
}

/** Listening/recording exercises stay silent for their whole focused lifetime. */
export function useQuietStudy(active = true) {
  useBlockerRegistration(active);
}

/** Narration can outlive screen focus, so track it until pause/end/unmount. */
export function useNarrationActivity(playing: boolean) {
  React.useEffect(() => {
    if (!playing) return;
    const id = Symbol('narration');
    useAmbientActivity.setState((state) => ({ narrations: new Set(state.narrations).add(id) }));
    return () => {
      useAmbientActivity.setState((state) => {
        const narrations = new Set(state.narrations);
        narrations.delete(id);
        return { narrations };
      });
    };
  }, [playing]);
}
