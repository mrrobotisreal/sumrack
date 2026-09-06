import { useQuietStudy } from '@/features/ambient-audio/activity';
import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, TextInput, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';
import { answersMatch } from '@/lib/text';

import type { ListeningOutcome } from '../../mapping';
import type { ListeningItem } from './session';
import { useListeningAudio } from './use-listening-audio';

/** Pause after a correct answer so the coloring registers (T06 rhythm). */
const FEEDBACK_DELAY_MS = 900;

interface ListeningViewProps {
  entry: ListeningItem;
  onDone: (outcome: ListeningOutcome) => void;
}

/**
 * Listening quiz (design §7.3 mode 5): the clip auto-plays, replay and
 * slow-replay stay available throughout, and the answer comes back as a
 * pick-from-4 tap or typed Russian (ё/е- and case-tolerant via the shared
 * matcher). Wrong answers and give-ups pause on an explicit Continue (the
 * correction + gloss deserve a read); correct answers advance themselves.
 * Remounted per item (key on the session screen).
 */
export function ListeningView({ entry, onDone }: ListeningViewProps) {
  useQuietStudy();
  const { tokens: theme } = useAppTheme();
  const audio = useListeningAudio(entry.audio);

  const [answered, setAnswered] = React.useState<null | { text: string; correct: boolean }>(null);
  const [revealed, setRevealed] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [selectedChoice, setSelectedChoice] = React.useState<string | null>(null);
  const replaysRef = React.useRef(0);
  const slowReplaysRef = React.useRef(0);

  const shownAtRef = React.useRef(0);
  React.useEffect(() => {
    shownAtRef.current = Date.now();
  }, []);

  const finish = React.useCallback(
    (correct: boolean, delayMs?: number) => {
      const outcome: ListeningOutcome = {
        variant: entry.variant,
        correct,
        replays: replaysRef.current,
        slowReplays: slowReplaysRef.current,
        durationMs: Date.now() - shownAtRef.current,
      };
      if (delayMs) setTimeout(() => onDone(outcome), delayMs);
      else onDone(outcome);
    },
    [entry.variant, onDone],
  );

  const replay = React.useCallback(
    (slow: boolean) => {
      // The auto-play on mount is the prompt; every user-initiated play is a replay.
      if (slow) slowReplaysRef.current += 1;
      else replaysRef.current += 1;
      track('listening_replay', { slow, source: entry.audio.kind });
      audio.play(slow);
    },
    [audio, entry.audio.kind],
  );

  const answer = React.useCallback(
    (text: string, viaChoice: string | null) => {
      if (answered || revealed) return;
      const correct = answersMatch(entry.answerRu, text);
      Vibration.vibrate(correct ? 8 : 24);
      audio.stop();
      setAnswered({ text, correct });
      if (viaChoice != null) setSelectedChoice(viaChoice);
      if (correct) finish(true, FEEDBACK_DELAY_MS);
      // wrong → explicit Continue below
    },
    [answered, revealed, entry.answerRu, audio, finish],
  );

  const giveUp = React.useCallback(() => {
    if (answered || revealed) return;
    setRevealed(true);
    Vibration.vibrate(24);
    audio.stop();
  }, [answered, revealed, audio]);

  const showContinue = (answered && !answered.correct) || revealed;
  const showAnswer = !!answered || revealed;

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        Listening · {entry.variant === 'pick4' ? 'pick what you hear' : 'type what you hear'}
      </Text>

      {/* audio card: replay + slow replay always available */}
      <View className="mt-4 items-center rounded-2xl border border-border bg-surface px-5 py-7">
        <View className="flex-row items-center gap-5">
          <Pressable
            onPress={() => replay(false)}
            accessibilityRole="button"
            accessibilityLabel="Replay audio"
            className="h-20 w-20 items-center justify-center rounded-full bg-accent active:opacity-80"
          >
            <Ionicons name="volume-high" size={34} color={theme.bg} />
          </Pressable>
          <Pressable
            onPress={() => replay(true)}
            accessibilityRole="button"
            accessibilityLabel="Replay slowly"
            className="h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-2 active:bg-border"
          >
            <RNText className="font-ui-medium text-sm text-text">0.7×</RNText>
          </Pressable>
        </View>

        {/* the answer reveal — the word itself + gloss, shown once resolved */}
        {showAnswer && (
          <View className="mt-5 items-center gap-1">
            <RNText
              className="font-reading text-2xl"
              style={{ color: answered?.correct ? theme.success : theme.danger }}
            >
              {entry.answerRu}
            </RNText>
            {entry.translation && <Text variant="muted">{entry.translation}</Text>}
          </View>
        )}
      </View>

      {/* wrong typed answer: show what was typed vs what was said */}
      {answered && !answered.correct && entry.variant === 'typed' && (
        <Text className="mt-3 text-center" variant="muted">
          You typed «{answered.text.trim()}»
        </Text>
      )}

      {entry.variant === 'pick4' && entry.choices ? (
        <View className="mt-5 flex-row flex-wrap justify-center gap-2.5">
          {entry.choices.map((choice) => {
            const isCorrectChoice = answersMatch(entry.answerRu, choice);
            let frame = 'border-border bg-surface active:bg-surface-2';
            if (showAnswer) {
              if (isCorrectChoice) frame = 'border-success bg-success/15';
              else if (selectedChoice === choice) frame = 'border-danger bg-danger/15';
              else frame = 'border-border bg-surface opacity-50';
            }
            return (
              <Pressable
                key={choice}
                onPress={() => answer(choice, choice)}
                disabled={showAnswer}
                accessibilityRole="button"
                accessibilityLabel={`Answer: ${choice}`}
                className={`rounded-xl border px-4 py-3 ${frame}`}
              >
                <RNText className="font-reading text-lg text-text">{choice}</RNText>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View className="mt-5 gap-3">
          <TextInput
            value={typed}
            onChangeText={setTyped}
            editable={!showAnswer}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Type what you heard…"
            placeholderTextColor={theme.textMuted}
            onSubmitEditing={() => typed.trim() && answer(typed, null)}
            className="rounded-xl border border-border bg-surface px-4 py-3.5 font-reading text-xl text-text"
            accessibilityLabel="What you heard"
          />
          {!showAnswer && (
            <View className="flex-row gap-2">
              <Pressable
                onPress={giveUp}
                accessibilityRole="button"
                className="flex-1 items-center rounded-xl border border-danger/50 bg-danger/10 py-3 active:opacity-70"
              >
                <Text className="font-ui-medium">Can&apos;t tell</Text>
              </Pressable>
              <Pressable
                onPress={() => typed.trim() && answer(typed, null)}
                disabled={!typed.trim()}
                accessibilityRole="button"
                className={`flex-1 items-center rounded-xl py-3 ${
                  typed.trim() ? 'bg-accent active:opacity-80' : 'bg-surface-2 opacity-50'
                }`}
              >
                <Text className={`font-ui-medium ${typed.trim() ? 'text-bg' : ''}`}>Check</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {showContinue && (
        <Pressable
          onPress={() => finish(false)}
          accessibilityRole="button"
          className="mt-4 items-center rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Continue</Text>
        </Pressable>
      )}
    </View>
  );
}
