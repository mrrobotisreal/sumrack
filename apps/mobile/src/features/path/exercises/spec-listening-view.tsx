import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, TextInput, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { answersMatch } from '@/lib/text';
import { speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import { typedTextMatches } from './scoring';
import { ContinueButton, FEEDBACK_DELAY_MS, type SpecViewProps } from './spec-views';

/**
 * Authored listening exercise (T17): the spec's Russian text is spoken via
 * the SpeechService (Piper on-device, system TTS fallback — always offline,
 * T11), then picked from choices or typed. Normal-speed replays are free
 * (T14's reasoning: relistening IS listening practice); a test has no
 * slow-replay crutch.
 */
export function SpecListeningView({ spec, onDone }: SpecViewProps<'listening'>) {
  const { tokens: theme } = useAppTheme();
  const [answered, setAnswered] = React.useState<null | { text: string; correct: boolean }>(null);
  const [typed, setTyped] = React.useState('');
  const [played, setPlayed] = React.useState(false);

  const play = React.useCallback(() => {
    setPlayed(true);
    void speak(spec.text);
  }, [spec.text]);

  // Auto-play once when the item appears.
  React.useEffect(() => {
    const t = setTimeout(play, 350);
    return () => clearTimeout(t);
  }, [play]);

  const answer = (text: string, correct: boolean) => {
    if (answered) return;
    Vibration.vibrate(correct ? 8 : 24);
    setAnswered({ text, correct });
    if (correct) setTimeout(() => onDone(true), FEEDBACK_DELAY_MS);
  };

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        Listening · {spec.choices ? 'pick what you heard' : 'type what you heard'}
      </Text>

      <View className="mt-4 items-center rounded-2xl border border-border bg-surface px-5 py-8">
        <Pressable
          onPress={play}
          accessibilityRole="button"
          accessibilityLabel="Play the audio"
          className="h-16 w-16 items-center justify-center rounded-full bg-accent active:opacity-80"
        >
          <Ionicons name={played ? 'refresh' : 'play'} size={26} color={theme.bg} />
        </Pressable>
        <Text variant="caption" className="mt-3">
          {played ? 'Replay is free' : 'Tap to listen'}
        </Text>
        {answered && (
          <RNText
            className="mt-4 text-center font-reading text-xl"
            style={{ color: answered.correct ? theme.success : theme.text }}
          >
            «{spec.text}»
          </RNText>
        )}
      </View>

      {answered && !answered.correct && (
        <Text variant="muted" className="mt-3 text-center">
          You answered: «{answered.text}»
        </Text>
      )}

      {spec.choices ? (
        <View className="mt-5 gap-2.5">
          {spec.choices.map((choice) => {
            const isCorrect = answersMatch(spec.text, choice);
            let frame = 'border-border bg-surface active:bg-surface-2';
            if (answered) {
              if (isCorrect) frame = 'border-success bg-success/15';
              else if (answered.text === choice) frame = 'border-danger bg-danger/15';
              else frame = 'border-border bg-surface opacity-50';
            }
            return (
              <Pressable
                key={choice}
                onPress={() => answer(choice, isCorrect)}
                disabled={!!answered}
                accessibilityRole="button"
                accessibilityLabel={`Answer: ${choice}`}
                className={`rounded-xl border px-4 py-3.5 ${frame}`}
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
            editable={!answered}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Type what you heard…"
            placeholderTextColor={theme.textMuted}
            onSubmitEditing={() =>
              typed.trim() && answer(typed.trim(), typedTextMatches(spec.text, typed))
            }
            className="rounded-xl border border-border bg-surface px-4 py-3.5 font-reading text-xl text-text"
            accessibilityLabel="What you heard"
          />
          {!answered && (
            <Pressable
              onPress={() =>
                typed.trim() && answer(typed.trim(), typedTextMatches(spec.text, typed))
              }
              disabled={!typed.trim()}
              accessibilityRole="button"
              className={`items-center rounded-xl py-3 ${
                typed.trim() ? 'bg-accent active:opacity-80' : 'bg-surface-2 opacity-50'
              }`}
            >
              <Text className={`font-ui-medium ${typed.trim() ? 'text-bg' : ''}`}>Check</Text>
            </Pressable>
          )}
        </View>
      )}

      {answered && !answered.correct && <ContinueButton onPress={() => onDone(false)} />}
    </View>
  );
}
