import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';

/** One «Практика» row: the drill exam, and its before/after bests (T92 decision 2). */
export interface PracticeRow {
  packId: string;
  examId: string;
  title: string;
  before: number | null;
  after: number | null;
}

/**
 * «Практика» rows (decision 2): one per `course.practice` ref whose drill pack
 * is installed. Each opens the existing TORFL drill and shows the best drill
 * score before the floor's first unit attempt («до») and after it («после»).
 */
export function PracticeRows({ rows }: { rows: readonly PracticeRow[] }) {
  const router = useRouter();
  if (rows.length === 0) return null;
  return (
    <View className="gap-2" testID="floor-practice">
      <Text variant="caption" className="uppercase tracking-wider">
        Практика
      </Text>
      {rows.map((row) => (
        <Pressable
          key={`${row.packId}/${row.examId}`}
          onPress={() => {
            track('hotel_practice_opened', { packId: row.packId, examId: row.examId });
            router.push(
              `/torfl/drill?packId=${encodeURIComponent(row.packId)}&examId=${encodeURIComponent(row.examId)}&source=set` as never,
            );
          }}
          accessibilityRole="button"
          testID="floor-practice-row"
          className="gap-1 rounded-xl border border-border bg-surface p-3"
        >
          <Text className="font-ui-medium">{row.title}</Text>
          <Text variant="caption">
            {`до: ${row.before === null ? '—' : `${row.before}%`} · после: ${row.after === null ? '—' : `${row.after}%`}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
