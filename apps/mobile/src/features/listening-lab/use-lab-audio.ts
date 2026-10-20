import * as React from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { createAudioPlayer, requestRecordingPermissionsAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import {
  cancelAttemptRecording,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import { pauseAll } from '@/features/audio/arbiter';
import { useQuietStudy } from '@/features/ambient-audio/activity';
import { createSliceFocus } from '@/services/learning-focus';
import { getSpeechService } from '@/services/speech';

import { createLabAudio, type AudioPhase, type Take } from './audio-controller';

export function useLabAudio() {
  useQuietStudy();
  const [phase, setPhase] = React.useState<AudioPhase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [take, setTake] = React.useState<Take | null>(null);
  const [controller] = React.useState(() =>
    createLabAudio({
      player: (uri) => createAudioPlayer({ uri }, { updateInterval: 100 }),
      focus: createSliceFocus('listening-lab'),
      silence: () => {
        pauseAll();
        return getSpeechService().stop();
      },
      permission: async () => (await requestRecordingPermissionsAsync()).granted,
      recorder: {
        start: startAttemptRecording,
        cancel: cancelAttemptRecording,
        stop: async () => {
          const result = await stopAttemptRecording();
          const file = new File(Paths.cache, `listening-lab-${Crypto.randomUUID()}.wav`);
          new File(result.path).copy(file);
          return { path: file.uri, durationMs: result.durationMs };
        },
      },
      deleteTake: (path) => {
        try {
          const file = new File(path);
          if (file.exists) file.delete();
        } catch {
          /* Cache is disposable. */
        }
      },
      changed: (next, message) => {
        setPhase(next);
        setError(message);
      },
    }),
  );
  useFocusEffect(
    React.useCallback(
      () => () => {
        void controller
          .clearTake()
          .then(() => setTake(null))
          .catch(() => {});
      },
      [controller],
    ),
  );
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active')
        void controller.stop().catch(() => setError('Audio was interrupted. Your text is kept.'));
    });
    return () => {
      subscription.remove();
      void controller.dispose().catch(() => {});
    };
  }, [controller]);
  return {
    phase,
    error,
    take,
    play: controller.play,
    stop: () => controller.stop().catch(() => setError('Audio was interrupted. Try again.')),
    startRecording: controller.startRecording,
    finishRecording: async () => {
      const next = await controller.finishRecording();
      if (next) setTake(next);
    },
    playTake: () =>
      take
        ? controller.play({ uri: take.path, startMs: 0, endMs: take.durationMs }, 1)
        : Promise.resolve(),
  };
}
