import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useDailyPrefs } from '@/store/daily-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { DAILY_LENGTH_OPTIONS, type DailyWeights } from './prefs';

const WEIGHT_ROWS: { key: keyof DailyWeights; label: string; hint: string }[] = [
  { key: 'flashcard', label: 'Flashcards', hint: 'Flip and self-grade' },
  { key: 'mc', label: 'Multiple choice', hint: 'Pick the translation' },
  { key: 'cloze', label: 'Cloze', hint: 'Fill the missing word' },
  { key: 'sentenceBuilder', label: 'Sentence builder', hint: 'Rebuild from tiles' },
  { key: 'listening', label: 'Listening quiz', hint: 'Pick or type what you hear' },
];

const WEIGHT_MAX = 5;

/**
 * Daily-session settings (T14): session length + per-mode weights. Weight 0
 * turns a mode off; higher = served proportionally more often. Flashcards
 * remain the fallback when other modes can't source an exercise, whatever
 * their weight — the stepper shapes preference, not a guarantee.
 */
export function DailySettingsSection() {
  const { tokens } = useAppTheme();
  const { prefs, setLength, setWeight } = useDailyPrefs();

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Daily session
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        {/* session length */}
        <View className="px-4 py-3.5">
          <Text className="font-ui-medium">Session length</Text>
          <Text variant="caption">Items served per daily session (when enough are due)</Text>
          <View className="mt-3 flex-row gap-2">
            {DAILY_LENGTH_OPTIONS.map((option) => {
              const selected = prefs.length === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setLength(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  className={`flex-1 items-center rounded-full border py-2 ${
                    selected
                      ? 'border-accent bg-accent/15'
                      : 'border-border bg-surface-2 active:bg-border'
                  }`}
                >
                  <RNText
                    className={`font-ui-medium text-sm ${selected ? 'text-accent' : 'text-text'}`}
                  >
                    {option}
                  </RNText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* per-mode weights */}
        {WEIGHT_ROWS.map(({ key, label, hint }) => {
          const value = prefs.weights[key];
          return (
            <View
              key={key}
              className="flex-row items-center justify-between border-t border-border px-4 py-3"
            >
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">{label}</Text>
                <Text variant="caption">{value === 0 ? 'Off' : hint}</Text>
              </View>
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={() => setWeight(key, Math.max(0, value - 1))}
                  disabled={value === 0}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Less ${label}`}
                  className={`h-9 w-9 items-center justify-center rounded-full bg-surface-2 ${
                    value === 0 ? 'opacity-40' : 'active:bg-border'
                  }`}
                >
                  <Ionicons name="remove" size={18} color={tokens.text} />
                </Pressable>
                <RNText className="w-5 text-center font-ui-medium text-base text-text">
                  {value}
                </RNText>
                <Pressable
                  onPress={() => setWeight(key, Math.min(WEIGHT_MAX, value + 1))}
                  disabled={value === WEIGHT_MAX}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`More ${label}`}
                  className={`h-9 w-9 items-center justify-center rounded-full bg-surface-2 ${
                    value === WEIGHT_MAX ? 'opacity-40' : 'active:bg-border'
                  }`}
                >
                  <Ionicons name="add" size={18} color={tokens.text} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}
