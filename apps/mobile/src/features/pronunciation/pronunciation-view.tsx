import { useQuietStudy } from '@/features/ambient-audio/activity';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as React from 'react';
import { Linking, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import SherpaSpeech from '../../../modules/sherpa-speech';
import { transcribeWav } from './asr-service';
import {
  cancelAttemptRecording,
  MAX_ATTEMPT_MS,
  requestMicPermission,
  startAttemptRecording,
  stopAttemptRecording,
} from './recorder';
import { RecordButton, type RecordButtonState } from './record-button';
import { PRONUNCIATION_PASS_SCORE, scoreAttempt, type PronunciationScore } from './scoring';
import type { PronunciationItem } from './session';

type AttemptPhase = 'idle' | 'recording' | 'processing' | 'feedback' | 'mic-denied' | 'error';

interface PronunciationViewProps {
  entry: PronunciationItem;
  /** Called once when Mitch moves on; bestScore drives the FSRS rating. */
  onComplete: (bestScore: number, attempts: number) => void;
}

/**
 * One pronunciation item (design §7.3 mode 6): prompt → optional model
 * playback → record → per-word green/red feedback → retry loop. Retrying is
 * free practice; Continue grades the BEST attempt (no punishment mechanics).
 */
export function PronunciationView({ entry, onComplete }: PronunciationViewProps) {
  useQuietStudy();
  const { tokens } = useAppTheme();
  const [phase, setPhase] = React.useState<AttemptPhase>('idle');
  const [level, setLevel] = React.useState(0);
  const [result, setResult] = React.useState<PronunciationScore | null>(null);
  const [heardText, setHeardText] = React.useState('');
  const [errorMsg, setErrorMsg] = React.useState('');
  const attemptsRef = React.useRef(0);
  const bestScoreRef = React.useRef(0);
  const attemptPathRef = React.useRef<string | null>(null);
  const replayPlayerRef = React.useRef<AudioPlayer | null>(null);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  React.useEffect(() => {
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l }) => {
      setLevel(l);
    });
    return () => {
      sub.remove();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      replayPlayerRef.current?.release();
      // Leaving mid-recording (quit / unmount): drop the partial file.
      if (phaseRef.current === 'recording') void cancelAttemptRecording();
    };
  }, []);

  const finishRecording = React.useCallback(async () => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    setPhase('processing');
    try {
      const { path, durationMs } = await stopAttemptRecording();
      attemptPathRef.current = path;
      const transcript = await transcribeWav(path);
      const scored = scoreAttempt(entry.promptRu, transcript.text);
      attemptsRef.current += 1;
      bestScoreRef.current = Math.max(bestScoreRef.current, scored.score);
      setResult(scored);
      setHeardText(transcript.text.trim());
      setPhase('feedback');
      track('pron_attempt', {
        score: scored.score,
        matched: scored.matchedCount,
        total: scored.totalCount,
        attempt: attemptsRef.current,
        decodeMs: transcript.decodeMs,
        audioMs: durationMs,
        source: entry.source,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'could not process the recording');
      setPhase('error');
    }
  }, [entry.promptRu, entry.source]);

  const startRecording = React.useCallback(async () => {
    const permission = await requestMicPermission();
    if (permission !== 'granted') {
      setPhase('mic-denied');
      return;
    }
    try {
      replayPlayerRef.current?.release();
      replayPlayerRef.current = null;
      await startAttemptRecording();
      setLevel(0);
      setPhase('recording');
      // Hard cap — a forgotten open mic should stop itself.
      autoStopRef.current = setTimeout(() => {
        if (phaseRef.current === 'recording') void finishRecording();
      }, MAX_ATTEMPT_MS);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'recording failed');
      setPhase('error');
    }
  }, [finishRecording]);

  const replayAttempt = React.useCallback(() => {
    const path = attemptPathRef.current;
    if (!path) return;
    replayPlayerRef.current?.release();
    const player = createAudioPlayer({ uri: path });
    replayPlayerRef.current = player;
    player.play();
  }, []);

  const passed = (result?.score ?? 0) >= PRONUNCIATION_PASS_SCORE;

  const buttonState: RecordButtonState =
    phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : 'idle';

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-grow px-6 pt-6"
      keyboardShouldPersistTaps="handled"
    >
      {/* prompt */}
      <View className="items-center gap-3">
        <Text variant="caption" className="uppercase tracking-wider">
          Say it aloud
        </Text>
        <RNText className="text-center font-reading text-3xl leading-snug text-text">
          {entry.promptRu}
        </RNText>
        {entry.promptEn && (
          <Text variant="muted" className="text-center">
            {entry.promptEn}
          </Text>
        )}
        <Pressable
          onPress={() => void speak(entry.promptRu)}
          accessibilityRole="button"
          accessibilityLabel="Hear the phrase"
          className="mt-1 flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 active:bg-surface-2"
        >
          <Ionicons name="volume-medium-outline" size={18} color={tokens.accent} />
          <Text variant="caption" className="text-accent">
            Listen first
          </Text>
        </Pressable>
      </View>

      {/* feedback */}
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
                  style={{ color: w.matched ? tokens.success : tokens.danger }}
                >
                  {w.display}
                </RNText>
              </View>
            ))}
          </View>
          <View className="items-center gap-1">
            <RNText
              className="font-ui-bold text-4xl"
              style={{ color: passed ? tokens.success : tokens.text }}
            >
              {result.score}%
            </RNText>
            <Text variant="muted">
              {passed
                ? 'Отлично — that landed.'
                : result.score > 0
                  ? 'Getting there — red words need another pass.'
                  : 'Не расслышал — try once more, a bit slower.'}
            </Text>
            {heardText.length > 0 && (
              <Text variant="caption" className="mt-1 text-center">
                Heard: «{heardText}»
              </Text>
            )}
          </View>
        </View>
      )}

      {phase === 'mic-denied' && (
        <View className="mt-8 items-center gap-3 px-4">
          <Ionicons name="mic-off-outline" size={40} color={tokens.textMuted} />
          <Text className="text-center font-ui-medium">Microphone access needed</Text>
          <Text variant="muted" className="text-center">
            Pronunciation practice scores your spoken Russian on-device — nothing is uploaded. Allow
            microphone access in system settings to play this mode.
          </Text>
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            className="mt-1 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
          >
            <Text className="text-accent">Open settings</Text>
          </Pressable>
          <Pressable onPress={() => setPhase('idle')} accessibilityRole="button" hitSlop={8}>
            <Text variant="caption">Try again</Text>
          </Pressable>
        </View>
      )}

      {phase === 'error' && (
        <View className="mt-8 items-center gap-3 px-4">
          <Ionicons name="alert-circle-outline" size={36} color={tokens.danger} />
          <Text variant="muted" className="text-center">
            {errorMsg}
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

      {/* mic zone */}
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
            <View className="flex-row justify-center gap-3">
              <Pressable
                onPress={replayAttempt}
                accessibilityRole="button"
                accessibilityLabel="Play back your attempt"
                className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 active:bg-surface-2"
              >
                <Ionicons name="play-outline" size={16} color={tokens.textMuted} />
                <Text variant="caption">Yours</Text>
              </Pressable>
              <Pressable
                onPress={() => void startRecording()}
                accessibilityRole="button"
                accessibilityLabel="Record again"
                className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 active:bg-surface-2"
              >
                <Ionicons name="mic-outline" size={16} color={tokens.accent} />
                <Text variant="caption" className="text-accent">
                  Try again
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => onComplete(bestScoreRef.current, attemptsRef.current)}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80"
            >
              <Text className="font-ui-medium text-bg">Continue</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
