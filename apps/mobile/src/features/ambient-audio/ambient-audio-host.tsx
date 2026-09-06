import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as React from 'react';
import { AppState } from 'react-native';

import { useTtsStore } from '@/features/tts/store';
import { logError } from '@/services/error-log';
import { useAmbientPrefs } from '@/store/ambient-prefs';

import { useAmbientActivity } from './activity';
import { createAmbientController } from './controller';

export function AmbientAudioHost({ ready }: { ready: boolean }) {
  React.useEffect(() => {
    let foreground = AppState.currentState === 'active';
    let previousTarget = '';
    const controller = createAmbientController(
      // Background narration owns its own policy. Do not change that global flag.
      () => setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }),
      () =>
        createAudioPlayer(require('../../../assets/audio/creepy-bg-music-no-vocals.mp3'), {
          updateInterval: 1000,
          keepAudioSessionActive: true,
        }),
      (error) => logError('manual', error),
    );
    const update = () => {
      const { enabled, volume } = useAmbientPrefs.getState();
      const { activities, blockers } = useAmbientActivity.getState();
      const active =
        ready &&
        enabled &&
        foreground &&
        activities.size > 0 &&
        blockers.size === 0 &&
        !useTtsStore.getState().speaking &&
        !useTtsStore.getState().systemSpeaking;
      const target = `${active}:${volume}`;
      if (target === previousTarget) return;
      previousTarget = target;
      void controller.update(active, volume);
    };
    const prefsSub = useAmbientPrefs.subscribe(update);
    const activitySub = useAmbientActivity.subscribe(update);
    const speechSub = useTtsStore.subscribe(update);
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
      appSub.remove();
      controller.dispose();
    };
  }, [ready]);
  return null;
}
