import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Text as RNText, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@/components/ui/text';
import { useDailyActivity } from '@/db/hooks';
import { useGoalPrefs } from '@/store/goal-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { MAX_FREEZES } from './freeze';
import { useMotivation } from './use-motivation';

/**
 * The real Today goal ring (T19 — replaces the T06 placeholder bars):
 * concentric progress rings (outer = reviews, inner = reading) around the
 * streak flame, with freeze wallet and XP level alongside. All data live
 * from daily_activity + the motivation snapshot; the ring updates as the
 * day's activity accrues because every record* path invalidates both.
 */

const RING_SIZE = 132;

function ProgressRing({
  radius,
  strokeWidth,
  fraction,
  color,
  trackColor,
}: {
  radius: number;
  strokeWidth: number;
  fraction: number;
  color: string;
  trackColor: string;
}) {
  const c = RING_SIZE / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <>
      <Circle cx={c} cy={c} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      {clamped > 0 && (
        <Circle
          cx={c}
          cy={c}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${c} ${c})`}
        />
      )}
    </>
  );
}

export function GoalRingCard() {
  const { tokens } = useAppTheme();
  const { goal } = useGoalPrefs();
  const activity = useDailyActivity();
  const motivation = useMotivation();

  const reviewsDone = activity.data?.reviewsDone ?? 0;
  const readingMs = activity.data?.readingMs ?? 0;
  const readingMin = Math.floor(readingMs / 60_000);

  const reviewsFraction = goal.reviews > 0 ? reviewsDone / goal.reviews : 1;
  const readingFraction = goal.readingMin > 0 ? readingMs / (goal.readingMin * 60_000) : 1;

  const streak = motivation.data?.streak;
  const freeze = motivation.data?.freeze;
  const level = motivation.data?.level;
  const goalMetToday = motivation.data?.goalMetToday ?? false;
  const flameLit = goalMetToday || (streak?.todayCounted ?? false);

  return (
    <View className="rounded-xl border border-border bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text variant="caption" className="uppercase tracking-wider">
          Today
        </Text>
        {level && (
          <Text variant="caption">
            Level {level.level} · {level.intoLevel}/{level.levelSpan} XP
          </Text>
        )}
      </View>

      <View className="mt-3 flex-row items-center gap-5">
        {/* rings + flame */}
        <View style={{ width: RING_SIZE, height: RING_SIZE }}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <ProgressRing
              radius={RING_SIZE / 2 - 5}
              strokeWidth={9}
              fraction={reviewsFraction}
              color={tokens.accent}
              trackColor={tokens.surface2}
            />
            <ProgressRing
              radius={RING_SIZE / 2 - 19}
              strokeWidth={9}
              fraction={readingFraction}
              color={tokens.textMuted}
              trackColor={tokens.surface2}
            />
          </Svg>
          <View className="absolute inset-0 items-center justify-center">
            <Ionicons
              name={flameLit ? 'flame' : 'flame-outline'}
              size={26}
              color={flameLit ? tokens.accent : tokens.textMuted}
            />
            <RNText className="font-ui-bold text-2xl text-text">{streak?.current ?? 0}</RNText>
            <Text variant="caption">{(streak?.current ?? 0) === 1 ? 'day' : 'days'}</Text>
          </View>
        </View>

        {/* numbers */}
        <View className="flex-1 gap-2.5">
          <GoalLine
            icon="albums-outline"
            iconColor={tokens.accent}
            label="Reviews"
            value={`${reviewsDone} / ${goal.reviews}`}
            done={goal.reviews > 0 ? reviewsDone >= goal.reviews : true}
          />
          <GoalLine
            icon="book-outline"
            iconColor={tokens.textMuted}
            label="Reading"
            value={`${readingMin} / ${goal.readingMin} min`}
            done={goal.readingMin > 0 ? readingMin >= goal.readingMin : true}
          />
          <View className="flex-row items-center gap-1.5">
            {Array.from({ length: MAX_FREEZES }, (_, i) => (
              <Ionicons
                key={i}
                name="snow"
                size={15}
                color={i < (freeze?.available ?? 0) ? tokens.text : tokens.surface2}
              />
            ))}
            <Text variant="caption">
              {freeze?.available ?? 0}/{MAX_FREEZES} freezes
            </Text>
          </View>
          {goalMetToday && (
            <Text variant="caption" className="text-accent">
              Цель выполнена — goal met!
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function GoalLine({
  icon,
  iconColor,
  label,
  value,
  done,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  label: string;
  value: string;
  done: boolean;
}) {
  const { tokens } = useAppTheme();
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-1.5">
        <Ionicons name={icon} size={14} color={iconColor} />
        <Text variant="caption">{label}</Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <Text variant="caption" className={done ? 'text-text' : undefined}>
          {value}
        </Text>
        {done && <Ionicons name="checkmark-circle" size={14} color={tokens.accent} />}
      </View>
    </View>
  );
}
