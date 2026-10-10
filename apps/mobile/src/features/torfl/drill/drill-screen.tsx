import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { clearPassageOffsets } from '../items/passage-scroll';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { SessionShell } from '@/features/review/session-shell';
import { useAppTheme } from '@/theme/use-app-theme';

import { lightningPaceSec } from '../pace';
import { DrillItem } from './drill-item';
import { DrillSummary } from './drill-summary';
import { PaceBar } from './pace-bar';
import { useDrillSession, type DrillParams } from './use-drill-session';
import type { DrillSource } from './drill-model';
import { levelFromParam } from '../level-profile';

const SOURCES: readonly DrillSource[] = ['set', 'deck', 'lightning'];

/**
 * The drill runner (T70, TORFL §7.1) — route `/torfl/drill?packId&examId&
 * topic?&source=set|deck|lightning`. One runner for a `drill` exam set, the
 * exam deck («Работа над ошибками») and «Молния»: SessionShell chrome with
 * the education ambient, instant feedback + explain card per item, a pace
 * bar in «Молния» (visual only), then the summary.
 */
export function DrillScreen() {
  // T76: per-passage scroll memory lives for one drill session.
  React.useEffect(() => clearPassageOffsets, []);
  const { tokens } = useAppTheme();
  const q = useLocalSearchParams<{
    packId?: string;
    examId?: string;
    topic?: string;
    source?: string;
    level?: string;
  }>();
  const params = React.useMemo<DrillParams>(
    () => ({
      source: SOURCES.find((s) => s === q.source) ?? 'set',
      packId: q.packId,
      examId: q.examId,
      topic: q.topic || undefined,
      level: levelFromParam(q.level),
    }),
    [q.packId, q.examId, q.topic, q.source, q.level],
  );
  const session = useDrillSession(params);

  if (session.phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (session.phase === 'error') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError message="Не удалось собрать тренировку." onRetry={session.retry} />
        <Pressable
          onPress={() => session.router.back()}
          accessibilityRole="button"
          className="rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Назад</Text>
        </Pressable>
      </View>
    );
  }
  if (session.phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8" testID="drill-empty">
        <Text className="font-reading text-xl">
          {params.source === 'deck' ? 'Колода пуста' : 'Заданий нет'}
        </Text>
        <Text variant="muted" className="text-center">
          {params.source === 'deck'
            ? 'Сейчас нет карточек к повторению. Решай тренировки — ошибки вернутся сюда.'
            : 'В этой тренировке нет заданий, которые можно решить здесь.'}
        </Text>
        <Pressable
          onPress={() => session.router.back()}
          accessibilityRole="button"
          className="mt-2 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Назад</Text>
        </Pressable>
      </View>
    );
  }
  if (session.phase === 'summary' && session.outcome) {
    return <DrillSummary outcome={session.outcome} onDone={() => session.router.back()} />;
  }

  const entry = session.entry!;
  const lightning = params.source === 'lightning';
  return (
    <SessionShell
      current={session.index}
      total={session.entries.length}
      onQuit={session.quit}
      ambientTheme="education"
    >
      {lightning && (
        <PaceBar
          paceSec={lightningPaceSec(params.level ?? 'A1')}
          resetKey={entry.itemKey}
          running
        />
      )}
      <DrillItem
        key={entry.itemKey}
        entry={entry}
        last={session.index === session.entries.length - 1}
        onAnswered={(args) => session.answered(entry, args)}
        onNext={() => void session.next()}
      />
    </SessionShell>
  );
}
