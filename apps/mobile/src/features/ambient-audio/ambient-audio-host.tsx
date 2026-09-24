import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as React from 'react';
import { AppState } from 'react-native';

import { useTtsStore } from '@/features/tts/store';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAmbientCursors } from '@/store/ambient-cursors';
import { useAmbientPrefs } from '@/store/ambient-prefs';

import { effectiveTheme, useAmbientActivity } from './activity';
import { AMBIENT_THEMES } from './beds';
import { createAmbientController } from './controller';
import { shouldPlayAmbience } from './playback-policy';

export function AmbientAudioHost({ ready }: { ready: boolean }) {
  React.useEffect(() => {
    let foreground = AppState.currentState === 'active';
    let previousTarget = '';
    const controller = createAmbientController(
      // Background narration owns its own policy. Do not change that global flag.
      () => setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }),
      // T48: the ONE ambient player; the controller swaps its source per theme.
      (source) =>
        createAudioPlayer(source, {
          updateInterval: 1000,
          keepAudioSessionActive: true,
        }),
      (error) => logError('manual', error),
      {
        themes: AMBIENT_THEMES,
        // Cursors are read on start/switch and written by the controller; the
        // host only watches the store's reset signal (below).
        getCursor: (theme) => useAmbientCursors.getState().cursors[theme],
        saveCursor: (theme, cursor) => useAmbientCursors.getState().setCursor(theme, cursor),
        onEvent: (event, props) => track(event, props),
      },
    );
    const update = () => {
      const prefs = useAmbientPrefs.getState();
      const { volume } = prefs;
      const { activities, blockers, narrations } = useAmbientActivity.getState();
      const speech = useTtsStore.getState();
      const active = shouldPlayAmbience(prefs, {
        ready,
        foreground,
        studying: activities.size > 0,
        blocked: blockers.size > 0,
        speaking: speech.speaking || speech.systemSpeaking,
        narrating: narrations.size > 0,
      });
      const theme = effectiveTheme(activities);
      const target = `${active}:${volume}:${theme}`;
      if (target === previousTarget) return;
      previousTarget = target;
      void controller.update(active, volume, theme);
    };
    const prefsSub = useAmbientPrefs.subscribe(update);
    const activitySub = useAmbientActivity.subscribe(update);
    const speechSub = useTtsStore.subscribe(update);
    // T49 «Reset rotation»: restart the loaded theme from bed 1 @ 0.
    const resetSub = useAmbientCursors.subscribe((state, previous) => {
      if (state.resetRevision !== previous.resetRevision && state.lastReset) {
        controller.restart(state.lastReset);
      }
    });
    // Synchronous pause on background/inactive, even if React hasn't rendered yet.
    const appSub = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      update();
    });
    update();
    return () => {
      prefsSub();
      activitySub();
      speechSub();
      resetSub();
      appSub.remove();
      controller.dispose();
    };
  }, [ready]);
  return null;
}
