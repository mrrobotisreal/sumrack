import * as React from 'react';
import { Pressable, Text as RNText, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';

import { DIRECTION_LABELS } from './format';
import { promptText, type SessionItem } from './session';

/** Pause after answering so the ✓/✗ coloring registers before advancing. */
const FEEDBACK_DELAY_MS = 900;

interface McViewProps {
  entry: SessionItem;
  onAnswer: (correct: boolean, durationMs: number) => void;
}

/**
 * Multiple choice (design §7.3 mode 2), both directions. The clock for the
 * fast/slow rating threshold (see mapping.ts) starts when choices render
 * (mount) and stops at the tap. After a tap the correct option always
 * lights up (learning moment on misses), then the session advances.
 */
export function McView({ entry, onAnswer }: McViewProps) {
  const [selectedIdx, setSelectedIdx] = React.useState<number | null>(null);
  // The fast/slow clock starts when the choices render (mount; remounted per card).
  const shownAtRef = React.useRef(0);
  React.useEffect(() => {
    shownAtRef.current = Date.now();
  }, []);
  const choices = React.useMemo(() => entry.choices ?? [], [entry.choices]);
  const promptIsRu = entry.direction !== 'en-ru';

  const select = React.useCallback(
    (idx: number) => {
      if (selectedIdx !== null) return;
      const choice = choices[idx];
      if (!choice) return;
      const durationMs = Date.now() - shownAtRef.current;
      Vibration.vibrate(choice.correct ? 8 : 24);
      setSelectedIdx(idx);
      setTimeout(() => onAnswer(choice.correct, durationMs), FEEDBACK_DELAY_MS);
    },
    [selectedIdx, choices, onAnswer],
  );

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        {DIRECTION_LABELS[entry.direction]} · pick the answer
      </Text>

      <View className="mt-4 min-h-36 items-center justify-center rounded-2xl border border-border bg-surface px-6 py-8">
        <RNText
          className={
            promptIsRu ? 'font-reading text-3xl text-text' : 'font-ui-medium text-2xl text-text'
          }
          style={{ textAlign: 'center' }}
        >
          {promptText(entry.item, entry.direction)}
        </RNText>
      </View>

      <View className="mt-5 gap-2.5">
        {choices.map((choice, idx) => {
          const answered = selectedIdx !== null;
          const isSelected = selectedIdx === idx;
          let frame = 'border-border bg-surface active:bg-surface-2';
          if (answered && choice.correct) frame = 'border-success bg-success/15';
          else if (answered && isSelected) frame = 'border-danger bg-danger/15';
          else if (answered) frame = 'border-border bg-surface opacity-50';
          return (
            <Pressable
              key={choice.bankItemId}
              onPress={() => select(idx)}
              disabled={answered}
              accessibilityRole="button"
              accessibilityLabel={`Answer: ${choice.text}`}
              className={`rounded-xl border px-4 py-3.5 ${frame}`}
            >
              <RNText
                className={
                  promptIsRu ? 'font-ui text-base text-text' : 'font-reading text-lg text-text'
                }
              >
                {choice.text}
              </RNText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
