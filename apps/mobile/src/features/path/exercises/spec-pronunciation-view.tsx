import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { isAsrInstalled } from '@/features/pronunciation/asr-manager';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import { RecordButton, type RecordButtonState } from '@/features/pronunciation/record-button';
import {
  cancelAttemptRecording,
  MAX_ATTEMPT_MS,
  requestMicPermission,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import {
  PRONUNCIATION_PASS_SCORE,
  scoreAttempt,
  type PronunciationScore,
} from '@/features/pronunciation/scoring';
import { speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import SherpaSpeech from '../../../../modules/sherpa-speech';
import type { SpecViewProps } from './spec-views';

interface Props extends SpecViewProps<'pronunciation'> {
  /** ASR model missing / mic denied: the item leaves the test's denominator. */
  onSkip: () => void;
}

type Phase = 'idle' | 'recording' | 'processing' | 'feedback' | 'error';

/**
 * Authored pronunciation exercise (T17): the T12 record → transcribe → align
 * loop against the spec's text. Retries are free; Continue submits the BEST
 * attempt, correct = best ≥ the T12 pass score (80). When the ASR model
 * isn't installed or the mic is denied, the item is SKIPPED — excluded from
 * the checkpoint denominator — rather than failing a test on missing
 * hardware (recorded T17 decision).
 */
export function SpecPronunciationView({ spec, onDone, onSkip }: Props) {
  const { tokens: theme } = useAppTheme();
  const asrReady = React.useMemo(() => isAsrInstalled(), []);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [level, setLevel] = React.useState(0);
  const [result, setResult] = React.useState<PronunciationScore | null>(null);
  const [micDenied, setMicDenied] = React.useState(false);
  const bestRef = React.useRef(0);
  const phaseRef = React.useRef<Phase>('idle');
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  React.useEffect(() => {
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l }) => setLevel(l));
    return () => {
      sub.remove();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (phaseRef.current === 'recording') void cancelAttemptRecording();
    };
  }, []);

  const finishRecording = React.useCallback(async () => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    setPhase('processing');
    try {
      const { path } = await stopAttemptRecording();
      const transcript = await transcribeWav(path);
      const scored = scoreAttempt(spec.text, transcript.text);
      bestRef.current = Math.max(bestRef.current, scored.score);
      setResult(scored);
      setPhase('feedback');
    } catch {
      setPhase('error');
    }
  }, [spec.text]);

  const startRecording = React.useCallback(async () => {
    const permission = await requestMicPermission();
    if (permission !== 'granted') {
      setMicDenied(true);
      return;
    }
    try {
      await startAttemptRecording();
      setLevel(0);
      setPhase('recording');
      autoStopRef.current = setTimeout(() => {
        if (phaseRef.current === 'recording') void finishRecording();
      }, MAX_ATTEMPT_MS);
    } catch {
      setPhase('error');
    }
  }, [finishRecording]);

  if (!asrReady || micDenied) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <Ionicons name="mic-off-outline" size={40} color={theme.textMuted} />
        <Text className="text-center font-ui-medium">
          {micDenied ? 'Microphone access needed' : 'Speech recognition not installed'}
        </Text>
        <Text variant="muted" className="text-center">
          {micDenied
            ? 'Without the mic this speaking item can’t be scored.'
            : 'Install the Russian speech model in Settings to score speaking items.'}{' '}
          It will be skipped — the rest of the test still counts.
        </Text>
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          className="mt-2 items-center rounded-xl bg-accent px-6 py-3 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Skip this item</Text>
        </Pressable>
      </View>
    );
  }

  const passed = (result?.score ?? 0) >= PRONUNCIATION_PASS_SCORE;
  const buttonState: RecordButtonState =
    phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : 'idle';

  return (
    <ScrollView className="flex-1" contentContainerClassName="flex-grow px-6 pt-6">
      <View className="items-center gap-3">
        <Text variant="caption" className="uppercase tracking-wider">
          Say it aloud
        </Text>
        <RNText className="text-center font-reading text-3xl leading-snug text-text">
          {spec.text}
        </RNText>
        <Pressable
          onPress={() => void speak(spec.text)}
          accessibilityRole="button"
          accessibilityLabel="Hear the phrase"
          className="mt-1 flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 active:bg-surface-2"
        >
          <Ionicons name="volume-medium-outline" size={18} color={theme.accent} />
          <Text variant="caption" className="text-accent">
            Listen first
          </Text>
        </Pressable>
      </View>

      {phase === 'feedback' && result && (
        <View className="mt-6 items-center gap-4">
          <View className="flex-row flex-wrap justify-center gap-2">
            {result.words.map((w, i) => (
              <View
                key={`${i}-${w.target}`}
                className={`rounded-lg px-2.5 py-1.5 ${w.matched ? 'bg-success/20' : 'bg-danger/25'}`}
              >
                <RNText
                  className="font-reading text-xl"
                  style={{ color: w.matched ? theme.success : theme.danger }}
                >
                  {w.display}
                </RNText>
              </View>
            ))}
          </View>
          <RNText
            className="font-ui-bold text-4xl"
            style={{ color: passed ? theme.success : theme.text }}
          >
            {result.score}%
          </RNText>
        </View>
      )}

      {phase === 'error' && (
        <View className="mt-8 items-center gap-3 px-4">
          <Ionicons name="alert-circle-outline" size={36} color={theme.danger} />
          <Text variant="muted" className="text-center">
            Could not process the recording.
          </Text>
          <Pressable
            onPress={() => setPhase('idle')}
            accessibilityRole="button"
            className="rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
          >
            <Text className="text-accent">Try again</Text>
          </Pressable>
        </View>
      )}

      <View className="flex-1 items-center justify-end pb-4">
        {phase === 'recording' && (
          <Text variant="caption" className="mb-2 text-danger">
            Recording — tap to stop
          </Text>
        )}
        {(phase === 'idle' || phase === 'recording' || phase === 'processing') && (
          <RecordButton
            state={buttonState}
            level={level}
            onPress={() => {
              if (phase === 'recording') void finishRecording();
              else if (phase === 'idle') void startRecording();
            }}
          />
        )}
        {phase === 'feedback' && (
          <View className="w-full gap-3">
            <View className="flex-row justify-center">
              <Pressable
                onPress={() => void startRecording()}
                accessibilityRole="button"
                accessibilityLabel="Record again"
                className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 active:bg-surface-2"
              >
                <Ionicons name="mic-outline" size={16} color={theme.accent} />
                <Text variant="caption" className="text-accent">
                  Try again
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => onDone(bestRef.current >= PRONUNCIATION_PASS_SCORE)}
              accessibilityRole="button"
              className="items-center rounded-xl bg-accent py-3.5 active:opacity-80"
            >
              <Text className="font-ui-medium text-bg">Continue</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
