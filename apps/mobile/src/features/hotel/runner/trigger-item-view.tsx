import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';

export interface TriggerItemShape {
  id: string;
  sentence: string;
  tokens: string[];
  answer: number;
}

/**
 * «Find the trigger» (HOTEL_PATH decision 9, T90 decision 3): the sentence's
 * tokens as tappable chips and the question «Какое слово требует эту форму?».
 * Tap one → `onAnswer(index)` once. `feedback: 'instant'` marks the right chip
 * green and a wrong pick red; `'none'` only records the pick (exam mode).
 */
export function TriggerItemView({
  item,
  feedback,
  onAnswer,
  initialIndex = null,
}: {
  item: TriggerItemShape;
  feedback: 'instant' | 'none';
  onAnswer: (index: number) => void;
  initialIndex?: number | null;
}) {
  const [picked, setPicked] = React.useState<number | null>(initialIndex);
  const locked = feedback === 'instant' && picked !== null;

  const pick = (idx: number) => {
    if (locked) return;
    setPicked(idx);
    onAnswer(idx);
  };

  // Each token is a chip; the index is the one the item's `answer` names.
  const words = item.tokens.map((text, i) => ({ text, index: i }));

  return (
    <View className="gap-5">
      <Text className="font-ui-medium text-sm text-text-muted">Какое слово требует эту форму?</Text>
      <View
        className="flex-row flex-wrap gap-2 rounded-2xl border border-border bg-surface px-4 py-5"
        testID="trigger-chips"
      >
        {words.map((w) => {
          let frame = 'border-border bg-surface-2';
          if (feedback === 'instant' && picked !== null) {
            if (w.index === item.answer) frame = 'border-success bg-success/15';
            else if (w.index === picked) frame = 'border-danger bg-danger/15';
          } else if (picked === w.index) {
            frame = 'border-accent bg-accent-soft';
          }
          return (
            <Pressable
              key={w.index}
              onPress={() => pick(w.index)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={`Слово: ${w.text}`}
              accessibilityState={{ selected: picked === w.index, disabled: locked }}
              testID={`trigger-chip-${w.index}`}
              className={`rounded-xl border px-3.5 py-2.5 ${frame}`}
            >
              <RNText className="font-reading text-lg text-text">{w.text}</RNText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
