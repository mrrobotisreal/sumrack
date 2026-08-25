import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Rating } from '@/db/repositories/reviews';
import { xpForRating } from '@/features/motivation/xp';

import { ratingName } from './format';
import type { SessionResult } from './session-screen';

interface SummaryViewProps {
  results: SessionResult[];
  onDone: () => void;
  /**
   * Wall-clock session length (T14 daily session) — rendered as a stat row
   * with the session's review XP when provided; single-mode screens omit it.
   */
  durationMs?: number;
}

/** m:ss for the summary time stat. */
function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/**
 * End-of-session summary: accuracy, counts, rating breakdown, elapsed time +
 * review XP (T24 filled the T14-reserved slot: Σ per-rating XP from the T19
 * table — exactly what the session's grades added to daily_activity.xp).
 * Ember flash restraint: numbers, no confetti (UI_DESIGN §4).
 */
export function SummaryView({ results, onDone, durationMs }: SummaryViewProps) {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const xp = results.reduce((sum, r) => sum + xpForRating(r.rating), 0);

  const ratingCounts = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((rating) => ({
    rating,
    count: results.filter((r) => r.rating === rating).length,
  }));

  return (
    <View className="flex-1 items-center justify-center bg-bg px-6">
      <Text variant="caption" className="uppercase tracking-wider">
        Session complete
      </Text>
      <RNText className="mt-3 font-ui-bold text-6xl text-text">{accuracy}%</RNText>
      <Text variant="muted" className="mt-1">
        {correct} of {total} recalled
      </Text>

      <View className="mt-8 w-full flex-row justify-center gap-6">
        {ratingCounts.map(({ rating, count }) => (
          <View key={rating} className="items-center">
            <Text className="font-ui-bold text-xl">{count}</Text>
            <Text variant="caption">{ratingName(rating)}</Text>
          </View>
        ))}
      </View>

      {durationMs != null && (
        <View className="mt-6 w-full flex-row justify-center gap-6">
          <View className="items-center">
            <Text className="font-ui-bold text-xl">{formatElapsed(durationMs)}</Text>
            <Text variant="caption">Time</Text>
          </View>
          <View className="items-center">
            <Text className="font-ui-bold text-xl text-accent">+{xp}</Text>
            <Text variant="caption">XP</Text>
          </View>
        </View>
      )}

      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Finish session"
        className="mt-12 w-full items-center rounded-xl bg-accent py-4 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">Done</Text>
      </Pressable>
    </View>
  );
}
