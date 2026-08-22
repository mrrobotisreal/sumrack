import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';

import type { SbOutcome } from '../../mapping';
import { arrangementCorrect, type SbItem, type SbTile } from './session';

interface SbViewProps {
  entry: SbItem;
  onDone: (outcome: SbOutcome) => void;
}

/**
 * Sentence builder (design §7.3 mode 4): the English gloss on top, shuffled
 * word tiles below; tapping moves a tile into the answer row, tapping it
 * there takes it back (counted — take-backs cap the rating at Hard, see
 * mapping.ts). Check compares the arrangement positionally with the tolerant
 * matcher; the reveal always shows the authored sentence (punctuation
 * auto-placed from `ru`, never scored — T13 decision). Remounted per item.
 */
export function SbView({ entry, onDone }: SbViewProps) {
  /** Order of tile ids currently in the answer row. */
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<null | { correct: boolean }>(null);
  const removalsRef = React.useRef(0);
  const shownAtRef = React.useRef(0);
  React.useEffect(() => {
    shownAtRef.current = Date.now();
  }, []);

  const tileById = React.useMemo(() => new Map(entry.tiles.map((t) => [t.id, t])), [entry.tiles]);
  const wordCount = entry.answerTokens.length;

  const pick = (tile: SbTile) => {
    if (result) return;
    Vibration.vibrate(4);
    setChosen((c) => [...c, tile.id]);
  };

  const takeBack = (idx: number) => {
    if (result) return;
    removalsRef.current += 1;
    setChosen((c) => c.filter((_, i) => i !== idx));
  };

  const check = () => {
    if (result || chosen.length !== wordCount) return;
    const texts = chosen.map((id) => tileById.get(id)!.text);
    const correct = arrangementCorrect(
      texts,
      entry.answerTokens.map((t) => t.text),
    );
    Vibration.vibrate(correct ? 8 : 24);
    setResult({ correct });
  };

  const finish = () => {
    if (!result) return;
    onDone({
      correct: result.correct,
      removals: removalsRef.current,
      wordCount,
      durationMs: Date.now() - shownAtRef.current,
    });
  };

  return (
    <ScrollView className="flex-1 px-4 pt-6" contentContainerClassName="pb-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        Sentence builder · build the Russian
      </Text>

      <View className="mt-4 rounded-2xl border border-border bg-surface px-5 py-6">
        <RNText className="font-ui-medium text-xl text-text">{entry.source.sentence.en}</RNText>
      </View>

      {/* answer row */}
      <View className="mt-5 min-h-16 flex-row flex-wrap items-start gap-2 border-b border-border pb-3">
        {chosen.length === 0 && !result && (
          <Text variant="muted" className="py-2">
            Tap the tiles in order…
          </Text>
        )}
        {chosen.map((id, idx) => (
          <Pressable
            key={`${id}-${idx}`}
            onPress={() => takeBack(idx)}
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

      {/* tile pool */}
      <View className="mt-4 flex-row flex-wrap gap-2">
        {entry.tiles
          .filter((t) => !chosen.includes(t.id))
          .map((tile) => (
            <Pressable
              key={tile.id}
              onPress={() => pick(tile)}
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

      {result && (
        <View className="mt-5 rounded-2xl border border-border bg-surface px-5 py-4">
          <Text variant="caption" className="uppercase tracking-wider">
            {result.correct ? 'Верно' : 'The sentence was'}
          </Text>
          <RNText
            className={`mt-1.5 font-reading text-xl ${result.correct ? 'text-success' : 'text-text'}`}
          >
            {entry.source.sentence.ru}
          </RNText>
        </View>
      )}

      {result ? (
        <Pressable
          onPress={finish}
          accessibilityRole="button"
          className="mt-5 items-center rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Continue</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={check}
          disabled={chosen.length !== wordCount}
          accessibilityRole="button"
          className={`mt-5 items-center rounded-xl py-3.5 ${
            chosen.length === wordCount ? 'bg-accent active:opacity-80' : 'bg-surface-2 opacity-50'
          }`}
        >
          <Text className={`font-ui-medium ${chosen.length === wordCount ? 'text-bg' : ''}`}>
            Check
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
