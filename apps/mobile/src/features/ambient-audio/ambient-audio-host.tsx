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
import { resolveAmbientDecision } from './playback-policy';
import { currentScoreSource, useAmbientScores } from './score-source';

export function AmbientAudioHost({ ready }: { ready: boolean }) {
  React.useEffect(() => {
    let foreground = AppState.currentState === 'active';
    let previousTarget = '';
    const controller = createAmbientController(
      // ISS-006 F3: expo-audio's mode is ONE global, last writer wins, and an
      // omitted `shouldPlayInBackground` is written as false — which makes the
      // native module pause EVERY player (the narration too) on Home. Pass the
      // same `true` the reader and the listen player set; this player still goes
      // quiet in the background through the policy's `foreground` gate (AppState below).
      () =>
        setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
          shouldPlayInBackground: true,
        }),
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
    /** score_unavailable fires once per part + reason, not per tick. */
    let lastUnavailable = '';
    const update = () => {
      const prefs = useAmbientPrefs.getState();
      const { volume } = prefs;
      const { activities, blockers, narrations } = useAmbientActivity.getState();
      const speech = useTtsStore.getState();
      const source = currentScoreSource(useAmbientScores.getState().sources);
      const decision = resolveAmbientDecision(
        prefs,
        {
          ready,
          foreground,
          studying: activities.size > 0,
          blocked: blockers.size > 0,
          speaking: speech.speaking || speech.systemSpeaking,
          narrating: narrations.size > 0,
        },
        // T115: the current narration's part score, when it has one.
        source ? { downloaded: source.uri != null, playing: source.playing } : null,
      );
      if (source && decision.unavailable) {
        const sig = `${source.key}:${decision.unavailable}`;
        if (sig !== lastUnavailable) {
          lastUnavailable = sig;
          track('score_unavailable', {
            packId: source.props.packId,
            storyId: source.props.storyId,
            reason: decision.unavailable,
          });
        }
      } else if (!source) lastUnavailable = '';
      const theme = effectiveTheme(activities);
      const { active } = decision;
      if (decision.source === 'score' && source?.uri) {
        const target = `score:${active}:${volume}:${source.key}:${source.rate}:${source.seekRevision}`;
        if (target === previousTarget) return;
        previousTarget = target;
        void controller.update(active, volume, theme, {
          key: source.key,
          uri: source.uri,
          durationMs: source.durationMs,
          positionMs: source.positionMs,
          rate: source.rate,
          seekRevision: source.seekRevision,
          props: source.props,
        });
        return;
      }
      const target = `${active}:${volume}:${theme}`;
      if (target === previousTarget) return;
      previousTarget = target;
      void controller.update(active, volume, theme);
    };
    const prefsSub = useAmbientPrefs.subscribe(update);
    const activitySub = useAmbientActivity.subscribe(update);
    const speechSub = useTtsStore.subscribe(update);
    const scoreSub = useAmbientScores.subscribe(update);
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
      scoreSub();
      resetSub();
      appSub.remove();
      controller.dispose();
    };
  }, [ready]);
  return null;
}
