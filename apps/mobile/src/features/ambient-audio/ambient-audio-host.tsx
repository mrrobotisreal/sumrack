import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as React from 'react';
import { AppState } from 'react-native';

import { useTtsStore } from '@/features/tts/store';
import { logError } from '@/services/error-log';
import { useAmbientPrefs } from '@/store/ambient-prefs';

import { useAmbientActivity } from './activity';
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
      () =>
        // T47: the registry's horror bed (same master, re-encoded to Opus at
        // its own level). T48 walks the per-theme rotation from here.
        createAudioPlayer(AMBIENT_THEMES.horror.beds[0]!.source, {
          updateInterval: 1000,
          keepAudioSessionActive: true,
        }),
      (error) => logError('manual', error),
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
