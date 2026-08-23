import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useGoalPrefs } from '@/store/goal-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { evaluateMotivation } from './service';
import { GOAL_READING_OPTIONS, GOAL_REVIEW_OPTIONS } from './goal-prefs';
import { MAX_FREEZES } from './freeze';
import { useMotivation } from './use-motivation';

/**
 * Daily goal + streak settings (T19, §7.7). Changing the goal re-evaluates
 * immediately, so lowering it below what's already done today stamps the
 * goal as met right away (the stamp is a one-way door — see stats repo).
 * A 0 target disables that half of the goal (both-zero heals to defaults).
 */
export function GoalSettingsSection() {
  const { tokens } = useAppTheme();
  const { goal, setGoal } = useGoalPrefs();
  const motivation = useMotivation();

  const freeze = motivation.data?.freeze;
  const lastFrozen = motivation.data?.lastFrozenDay ?? null;
  const streak = motivation.data?.streak;

  const apply = (patch: Partial<typeof goal>) => {
    setGoal({ ...goal, ...patch });
    void evaluateMotivation();
  };

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Daily goal & streak
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        <OptionRow
          label="Reviews per day"
          hint="0 = reviews don't gate the goal"
          options={GOAL_REVIEW_OPTIONS}
          value={goal.reviews}
          onSelect={(reviews) => apply({ reviews })}
        />
        <OptionRow
          label="Reading minutes per day"
          hint="0 = reading doesn't gate the goal"
          options={GOAL_READING_OPTIONS}
          value={goal.readingMin}
          onSelect={(readingMin) => apply({ readingMin })}
          borderTop
        />

        <View className="border-t border-border px-4 py-3.5">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 gap-0.5 pr-3">
              <Text className="font-ui-medium">Streak freezes</Text>
              <Text variant="caption">
                Earned every 7 streak days, max {MAX_FREEZES} held. One covers one missed day.
              </Text>
              {lastFrozen && (
                <Text variant="caption" className="text-accent">
                  Last used on {lastFrozen.date}
                </Text>
              )}
            </View>
            <View className="flex-row items-center gap-1">
              {Array.from({ length: MAX_FREEZES }, (_, i) => (
                <Ionicons
                  key={i}
                  name="snow"
                  size={18}
                  color={i < (freeze?.available ?? 0) ? tokens.text : tokens.surface2}
                />
              ))}
            </View>
          </View>
          {streak && streak.current > 0 && (
            <Text variant="caption" className="mt-2">
              Current streak: {streak.current} {streak.current === 1 ? 'day' : 'days'}
            </Text>
          )}
        </View>

        <Link href="/achievements" asChild>
          <Pressable className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2">
            <View className="gap-0.5">
              <Text className="font-ui-medium">Achievements</Text>
              <Text variant="caption">The gallery of unlocked milestones</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
          </Pressable>
        </Link>
      </View>
    </>
  );
}

function OptionRow({
  label,
  hint,
  options,
  value,
  onSelect,
  borderTop,
}: {
  label: string;
  hint: string;
  options: readonly number[];
  value: number;
  onSelect: (value: number) => void;
  borderTop?: boolean;
}) {
  return (
    <View className={`px-4 py-3.5 ${borderTop ? 'border-t border-border' : ''}`}>
      <Text className="font-ui-medium">{label}</Text>
      <Text variant="caption">{hint}</Text>
      <View className="mt-3 flex-row gap-2">
        {options.map((option) => {
          const selected = value === option;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(option)}
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
  );
}
