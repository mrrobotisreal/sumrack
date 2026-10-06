import type { ChoiceItem } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, Text as RNText, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';

import { OPTION_LETTERS } from '../scoring';
import { StemText } from './stem-text';

export type ItemFeedback = 'instant' | 'none';

/**
 * А–Г single choice (T70). `feedback: 'instant'` (drills): the correct option
 * glows green, a wrong pick is marked red, the buttons lock and
 * `onAnswer` fires once. `feedback: 'none'` (T71's mocks): the pick is only
 * highlighted, stays changeable, and `onAnswer` fires on every change — no
 * verdict is ever shown. `showStemEn` adds the EN gloss (drills only; the
 * caller never passes it in a mock).
 */
export function ChoiceItemView({
  item,
  feedback,
  onAnswer,
  initialIndex = null,
  showStemEn = false,
}: {
  item: ChoiceItem;
  feedback: ItemFeedback;
  onAnswer: (index: number) => void;
  initialIndex?: number | null;
  showStemEn?: boolean;
}) {
  const [picked, setPicked] = React.useState<number | null>(initialIndex);
  const locked = feedback === 'instant' && picked !== null;

  const pick = (idx: number) => {
    if (locked) return;
    if (feedback === 'instant') Vibration.vibrate(idx === item.answer ? 8 : 24);
    setPicked(idx);
    onAnswer(idx);
  };

  const fill =
    locked && item.options[item.answer] !== undefined
      ? item.options[item.answer]
      : picked !== null
        ? item.options[picked]
        : null;

  return (
    <View className="gap-5">
      <View className="gap-2 rounded-2xl border border-border bg-surface px-5 py-6">
        <StemText stem={item.stem} fill={fill} fillTone={locked ? 'success' : 'accent'} />
        {showStemEn && item.stemEn ? (
          <Text variant="caption" className="font-reading-italic">
            {item.stemEn}
          </Text>
        ) : null}
      </View>
      <View className="gap-2.5">
        {item.options.map((option, idx) => {
          let frame = 'border-border bg-surface active:bg-surface-2';
          if (feedback === 'instant' && picked !== null) {
            if (idx === item.answer) frame = 'border-success bg-success/15';
            else if (idx === picked) frame = 'border-danger bg-danger/15';
            else frame = 'border-border bg-surface opacity-50';
          } else if (picked === idx) {
            frame = 'border-accent bg-accent-soft';
          }
          return (
            <Pressable
              key={idx}
              onPress={() => pick(idx)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={`Answer: ${option}`}
              accessibilityState={{ selected: picked === idx, disabled: locked }}
              testID={`choice-option-${idx}`}
              className={`flex-row items-center gap-3 rounded-xl border px-4 py-3.5 ${frame}`}
            >
              <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2">
                <RNText className="font-ui-bold text-sm text-text-muted">
                  {OPTION_LETTERS[idx] ?? idx + 1}
                </RNText>
              </View>
              <RNText className="flex-1 font-reading text-lg text-text">{option}</RNText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
