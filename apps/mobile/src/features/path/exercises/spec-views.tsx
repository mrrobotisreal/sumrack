import type { ExerciseSpec } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, Text as RNText, TextInput, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { answersMatch } from '@/lib/text';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Per-kind views for AUTHORED/GENERATED ExerciseSpecs (T17). These mirror
 * the T06/T13 game views' look and rhythm (ember flash, 900ms dwell on a
 * correct answer, explicit Continue after a wrong one) but consume the spec
 * union directly and report a bare correct/incorrect — tests don't grade
 * FSRS cards (recorded T17 decision), so no card/bank plumbing lives here.
 */

export const FEEDBACK_DELAY_MS = 900;

type Spec<K extends ExerciseSpec['kind']> = Extract<ExerciseSpec, { kind: K }>;

export interface SpecViewProps<K extends ExerciseSpec['kind']> {
  spec: Spec<K>;
  onDone: (correct: boolean) => void;
}

/** Shared "you were wrong, here's the truth, move on" footer. */
export function ContinueButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="mt-4 items-center rounded-xl bg-accent py-3.5 active:opacity-80"
    >
      <Text className="font-ui-medium text-bg">Continue</Text>
    </Pressable>
  );
}

// --- multiple choice --------------------------------------------------------

export function SpecMcView({ spec, onDone }: SpecViewProps<'multiple-choice'>) {
  const [picked, setPicked] = React.useState<number | null>(null);
  const correctPick = picked === spec.correctIndex;

  const pick = (idx: number) => {
    if (picked !== null) return;
    const correct = idx === spec.correctIndex;
    Vibration.vibrate(correct ? 8 : 24);
    setPicked(idx);
    if (correct) setTimeout(() => onDone(true), FEEDBACK_DELAY_MS);
  };

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        {spec.direction === 'ru-en' ? 'What does it mean?' : 'Как это по-русски?'}
      </Text>
      <View className="mt-4 min-h-28 justify-center rounded-2xl border border-border bg-surface px-5 py-7">
        <RNText className="text-center font-reading text-3xl text-text">{spec.prompt}</RNText>
      </View>
      <View className="mt-5 gap-2.5">
        {spec.choices.map((choice, idx) => {
          let frame = 'border-border bg-surface active:bg-surface-2';
          if (picked !== null) {
            if (idx === spec.correctIndex) frame = 'border-success bg-success/15';
            else if (idx === picked) frame = 'border-danger bg-danger/15';
            else frame = 'border-border bg-surface opacity-50';
          }
          return (
            <Pressable
              key={idx}
              onPress={() => pick(idx)}
              disabled={picked !== null}
              accessibilityRole="button"
              accessibilityLabel={`Answer: ${choice}`}
              className={`rounded-xl border px-4 py-3.5 ${frame}`}
            >
              <RNText className="font-reading text-lg text-text">{choice}</RNText>
            </Pressable>
          );
        })}
      </View>
      {picked !== null && !correctPick && <ContinueButton onPress={() => onDone(false)} />}
    </View>
  );
}

// --- cloze ------------------------------------------------------------------

export function SpecClozeView({ spec, onDone }: SpecViewProps<'cloze'>) {
  const { tokens: theme } = useAppTheme();
  const [answered, setAnswered] = React.useState<null | { text: string; correct: boolean }>(null);
  const [typed, setTyped] = React.useState('');

  const answer = (text: string) => {
    if (answered) return;
    const correct = answersMatch(spec.answer, text);
    Vibration.vibrate(correct ? 8 : 24);
    setAnswered({ text, correct });
    if (correct) setTimeout(() => onDone(true), FEEDBACK_DELAY_MS);
  };

  const blank = answered ? answered.text : '______';
  const blankColor = answered ? (answered.correct ? theme.success : theme.danger) : theme.accent;
  const parts = spec.sentenceRu.split('___');

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        Cloze · {spec.choices ? 'pick the missing word' : 'type the missing word'}
      </Text>
      <View className="mt-4 min-h-32 justify-center rounded-2xl border border-border bg-surface px-5 py-7">
        <RNText className="font-reading text-2xl leading-10 text-text">
          {parts[0]}
          <RNText style={{ color: blankColor, fontWeight: '700' }}>{blank}</RNText>
          {parts.slice(1).join('___')}
        </RNText>
      </View>

      {answered && !answered.correct && (
        <Text className="mt-3 text-center">
          Correct: <Text className="font-ui-medium text-success">{spec.answer}</Text>
        </Text>
      )}

      {spec.choices ? (
        <View className="mt-5 flex-row flex-wrap justify-center gap-2.5">
          {spec.choices.map((tile) => {
            const isCorrectTile = answersMatch(spec.answer, tile);
            let frame = 'border-border bg-surface active:bg-surface-2';
            if (answered) {
              if (isCorrectTile) frame = 'border-success bg-success/15';
              else if (answered.text === tile) frame = 'border-danger bg-danger/15';
              else frame = 'border-border bg-surface opacity-50';
            }
            return (
              <Pressable
                key={tile}
                onPress={() => answer(tile)}
                disabled={!!answered}
                accessibilityRole="button"
                accessibilityLabel={`Answer: ${tile}`}
                className={`rounded-xl border px-4 py-3 ${frame}`}
              >
                <RNText className="font-reading text-lg text-text">{tile}</RNText>
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
            placeholder="Type the missing word…"
            placeholderTextColor={theme.textMuted}
            onSubmitEditing={() => typed.trim() && answer(typed)}
            className="rounded-xl border border-border bg-surface px-4 py-3.5 font-reading text-xl text-text"
            accessibilityLabel="Missing word"
          />
          {!answered && (
            <Pressable
              onPress={() => typed.trim() && answer(typed)}
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

// --- sentence builder -------------------------------------------------------

interface SbTile {
  id: string;
  text: string;
}

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function SpecSbView({ spec, onDone }: SpecViewProps<'sentence-builder'>) {
  const tiles = React.useMemo<SbTile[]>(
    () =>
      shuffle(
        [...spec.tokens, ...(spec.distractors ?? [])].map((text, i) => ({ id: `t${i}`, text })),
      ),
    [spec],
  );
  const tileById = React.useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles]);
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<null | { correct: boolean }>(null);

  const check = () => {
    if (result || chosen.length !== spec.tokens.length) return;
    const correct = chosen.every((id, i) => answersMatch(spec.tokens[i]!, tileById.get(id)!.text));
    Vibration.vibrate(correct ? 8 : 24);
    setResult({ correct });
    if (correct) setTimeout(() => onDone(true), FEEDBACK_DELAY_MS);
  };

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        Sentence builder · build the Russian
      </Text>
      <View className="mt-4 rounded-2xl border border-border bg-surface px-5 py-6">
        <RNText className="font-ui-medium text-xl text-text">{spec.en}</RNText>
      </View>

      <View className="mt-5 min-h-16 flex-row flex-wrap items-start gap-2 border-b border-border pb-3">
        {chosen.length === 0 && !result && (
          <Text variant="muted" className="py-2">
            Tap the tiles in order…
          </Text>
        )}
        {chosen.map((id, idx) => (
          <Pressable
            key={`${id}-${idx}`}
            onPress={() => !result && setChosen((c) => c.filter((_, i) => i !== idx))}
            disabled={!!result}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${tileById.get(id)!.text}`}
            className={`rounded-xl border px-3.5 py-2.5 ${
              result
                ? result.correct
                  ? 'border-success bg-success/15'
                  : 'border-danger bg-danger/15'
                : 'border-accent/50 bg-accent/10 active:bg-accent/20'
            }`}
          >
            <RNText className="font-reading text-lg text-text">{tileById.get(id)!.text}</RNText>
          </Pressable>
        ))}
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {tiles
          .filter((t) => !chosen.includes(t.id))
          .map((tile) => (
            <Pressable
              key={tile.id}
              onPress={() => {
                if (result) return;
                Vibration.vibrate(4);
                setChosen((c) => [...c, tile.id]);
              }}
              disabled={!!result}
              accessibilityRole="button"
              accessibilityLabel={`Add ${tile.text}`}
              className={`rounded-xl border border-border bg-surface px-3.5 py-2.5 active:bg-surface-2 ${
                result ? 'opacity-40' : ''
              }`}
            >
              <RNText className="font-reading text-lg text-text">{tile.text}</RNText>
            </Pressable>
          ))}
      </View>

      {result && !result.correct && (
        <View className="mt-5 rounded-2xl border border-border bg-surface px-5 py-4">
          <Text variant="caption" className="uppercase tracking-wider">
            The sentence was
          </Text>
          <RNText className="mt-1.5 font-reading text-xl text-text">{spec.tokens.join(' ')}</RNText>
        </View>
      )}

      {result ? (
        !result.correct && <ContinueButton onPress={() => onDone(false)} />
      ) : (
        <Pressable
          onPress={check}
          disabled={chosen.length !== spec.tokens.length}
          accessibilityRole="button"
          className={`mt-5 items-center rounded-xl py-3.5 ${
            chosen.length === spec.tokens.length
              ? 'bg-accent active:opacity-80'
              : 'bg-surface-2 opacity-50'
          }`}
        >
          <Text
            className={`font-ui-medium ${chosen.length === spec.tokens.length ? 'text-bg' : ''}`}
          >
            Check
          </Text>
        </Pressable>
      )}
    </View>
  );
}
