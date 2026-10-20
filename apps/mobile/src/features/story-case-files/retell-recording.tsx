import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { AppState, Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { pauseAll } from '@/features/audio/arbiter';
import { useQuietStudy } from '@/features/ambient-audio/activity';
import { requestMicPermission } from '@/features/pronunciation/recorder';
import { createSliceFocus } from '@/services/learning-focus';
import { track } from '@/services/analytics';
import type { CaseStage } from './model';
import SherpaSpeech from '../../../modules/sherpa-speech';

/** A private cache take, never a durable-media path or AI assessment. */
export function RetellRecording({ caseId, stage }: { caseId: string; stage: CaseStage }) {
  useQuietStudy();
  const [phase, setPhase] = React.useState<'idle' | 'busy' | 'recording' | 'playing'>('idle');
  const [hasTake, setHasTake] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [focus] = React.useState(() => createSliceFocus('case-file-retell'));
  const [file] = React.useState(
    () =>
      new File(Paths.cache, `case-retell-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`),
  );
  const alive = React.useRef(false);
  const recording = React.useRef(false);
  const busy = React.useRef(false);
  const player = React.useRef<AudioPlayer | null>(null);
  const cap = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCap = () => {
    if (cap.current) clearTimeout(cap.current);
    cap.current = null;
  };

  const stop = React.useCallback(async () => {
    if (!recording.current || busy.current) return;
    busy.current = true;
    recording.current = false;
    clearCap();
    if (alive.current) setPhase('busy');
    try {
      const take = await SherpaSpeech.stopRecording();
      track('case_file_recording', {
        caseId,
        stage,
        action: 'finished',
        durationMs: take.durationMs,
      });
      if (alive.current) setHasTake(take.durationMs > 0 && file.exists);
    } catch {
      if (alive.current)
        setError('The take could not be saved. Try recording again or use your typed retelling.');
    } finally {
      focus.release();
      busy.current = false;
      if (alive.current) setPhase('idle');
      else if (file.exists) file.delete();
    }
  }, [caseId, stage, file, focus]);

  useFocusEffect(
    React.useCallback(() => {
      alive.current = true;
      return () => {
        alive.current = false;
        clearCap();
        player.current?.remove();
        player.current = null;
        focus.release();
        if (recording.current) {
          recording.current = false;
          void SherpaSpeech.cancelRecording()
            .catch(() => undefined)
            .finally(() => {
              if (file.exists) file.delete();
            });
        } else if (file.exists) file.delete();
        setPhase('idle');
        setHasTake(false);
      };
    }, [file, focus]),
  );

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (recording.current) void stop();
        player.current?.pause();
        focus.release();
        if (!recording.current && alive.current) setPhase('idle');
      }
    });
    return () => subscription.remove();
  }, [focus, stop]);

  const start = async () => {
    if (busy.current || recording.current) return;
    busy.current = true;
    setPhase('busy');
    setError(null);
    try {
      if ((await requestMicPermission()) !== 'granted')
        throw new Error(
          'Microphone permission is unavailable. Enable it in Android settings, or use your typed retelling.',
        );
      if (!alive.current) return;
      player.current?.remove();
      player.current = null;
      pauseAll();
      await focus.acquire();
      if (!alive.current) {
        focus.release();
        return;
      }
      if (AppState.currentState !== 'active')
        throw new Error('Return to the app before recording.');
      await SherpaSpeech.startRecording(file.uri);
      if (!alive.current || AppState.currentState !== 'active') {
        await SherpaSpeech.cancelRecording();
        if (file.exists) file.delete();
        focus.release();
        return;
      }
      recording.current = true;
      setHasTake(false);
      setPhase('recording');
      track('case_file_recording', { caseId, stage, action: 'started' });
      cap.current = setTimeout(() => void stop(), 60_000);
    } catch (e) {
      track('case_file_recording', { caseId, stage, action: 'unavailable' });
      focus.release();
      if (alive.current) {
        setError(
          e instanceof Error
            ? e.message
            : 'Recording is unavailable. Your typed retelling still works.',
        );
        setPhase('idle');
      }
    } finally {
      busy.current = false;
    }
  };

  const play = async () => {
    if (busy.current || recording.current || !file.exists) return;
    if (phase === 'playing') {
      player.current?.pause();
      focus.release();
      setPhase('idle');
      return;
    }
    busy.current = true;
    setError(null);
    try {
      pauseAll();
      await focus.acquire();
      if (!alive.current) {
        focus.release();
        return;
      }
      player.current?.remove();
      const next = createAudioPlayer({ uri: file.uri });
      player.current = next;
      next.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          focus.release();
          if (alive.current) setPhase('idle');
        }
      });
      next.play();
      track('case_file_recording', { caseId, stage, action: 'played' });
      setPhase('playing');
    } catch {
      focus.release();
      if (alive.current) {
        setError('Playback is unavailable. You can try another take.');
        setPhase('idle');
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <View className="mt-5 gap-3">
      <Text variant="title">Say it aloud</Text>
      <Text variant="caption">
        Optional · up to 60 seconds. This practice take is temporary and is deleted when you leave.
        Only your typed retelling is saved with the attempt.
      </Text>
      <View className="flex-row flex-wrap gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            phase === 'recording' ? 'Stop retelling recording' : 'Record retelling'
          }
          accessibilityState={{ disabled: phase === 'busy' }}
          disabled={phase === 'busy'}
          onPress={() => void (phase === 'recording' ? stop() : start())}
          className="min-h-12 justify-center rounded-xl border border-border bg-surface px-4 py-3 active:opacity-80"
        >
          <Text>
            {phase === 'recording'
              ? 'Stop recording'
              : phase === 'busy'
                ? 'Please wait…'
                : 'Record a take'}
          </Text>
        </Pressable>
        {hasTake && phase !== 'recording' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={phase === 'playing' ? 'Pause your take' : 'Play your take'}
            disabled={phase === 'busy'}
            onPress={() => void play()}
            className="min-h-12 justify-center rounded-xl border border-border bg-surface px-4 py-3 active:opacity-80"
          >
            <Text>{phase === 'playing' ? 'Pause take' : 'Play take'}</Text>
          </Pressable>
        )}
      </View>
      {phase === 'recording' && (
        <Text accessibilityLiveRegion="polite">Recording… tap Stop when you finish.</Text>
      )}
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
    </View>
  );
}
