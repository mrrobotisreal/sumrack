import * as React from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import {
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
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
import { practiceAudioOwner } from '@/features/practice-retelling/audio-owner';

import { createLabAudio, type AudioPhase, type Take } from './audio-controller';
import { createRecordingPermissionGate } from './recording-permission';
import { copyCapturedTake } from './capture-take';

export function useLabAudio() {
  useQuietStudy();
  const [phase, setPhase] = React.useState<AudioPhase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [take, setTake] = React.useState<Take | null>(null);
  const [owner] = React.useState(() => Symbol('practice-audio'));
  const [permission] = React.useState(() =>
    createRecordingPermissionGate({
      read: getRecordingPermissionsAsync,
      request: requestRecordingPermissionsAsync,
    }),
  );
  const [controller] = React.useState(() => {
    const audio: ReturnType<typeof createLabAudio> = createLabAudio({
      player: (uri) => createAudioPlayer({ uri }, { updateInterval: 100 }),
      focus: createSliceFocus('listening-lab'),
      silence: async () => {
        await practiceAudioOwner.claim(owner, () => audio.stop());
        pauseAll();
        await getSpeechService().stop();
      },
      permission: permission.ensure,
      isActive: () => AppState.currentState === 'active',
      recorder: {
        start: startAttemptRecording,
        cancel: cancelAttemptRecording,
        stop: async () => {
          const result = await stopAttemptRecording();
          const file = new File(Paths.cache, `listening-lab-${Crypto.randomUUID()}.wav`);
          return copyCapturedTake(result, file.uri, (sourceUri, destinationUri) =>
            new File(sourceUri).copy(new File(destinationUri)),
          );
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
    });
    return audio;
  });
  useFocusEffect(
    React.useCallback(
      () => () => {
        practiceAudioOwner.release(owner);
        void controller
          .clearTake()
          .then(() => setTake(null))
          .catch(() => {});
      },
      [controller, owner],
    ),
  );
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      void permission
        .onAppStateChange(state, controller.stop)
        .catch(() => setError('Audio was interrupted. Your text is kept.'));
    });
    return () => {
      subscription.remove();
      void controller.dispose().catch(() => {});
    };
  }, [controller, permission]);
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
        ? controller.play(
            { uri: take.path, startMs: 0, endMs: take.durationMs, stopAtFileEnd: true },
            1,
          )
        : Promise.resolve(),
  };
}
