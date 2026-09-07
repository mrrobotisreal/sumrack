import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { create } from 'zustand';

export const useAmbientActivity = create<{
  activities: ReadonlySet<symbol>;
  blockers: ReadonlySet<symbol>;
  narrations: ReadonlySet<symbol>;
}>(() => ({ activities: new Set(), blockers: new Set(), narrations: new Set() }));

function useRegistration(kind: 'activities' | 'blockers', enabled: boolean) {
  useFocusEffect(
    React.useCallback(() => {
      if (!enabled) return;
      const id = Symbol(kind);
      useAmbientActivity.setState((s) => ({ [kind]: new Set(s[kind]).add(id) }));
      return () => {
        useAmbientActivity.setState((s) => {
          const next = new Set(s[kind]);
          next.delete(id);
          return { [kind]: next };
        });
      };
    }, [kind, enabled]),
  );
}

/** Focus cleanup also covers a still-mounted reader underneath a modal/game. */
export function useStudyAmbience(active = true) {
  useRegistration('activities', active);
}

/** Listening/recording exercises stay silent for their whole focused lifetime. */
export function useQuietStudy(active = true) {
  useRegistration('blockers', active);
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
