import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import type { Cefr } from '@/db/repositories/dashboard';
import { track } from '@/services/analytics';

import { useCoreGaps } from './hooks';

const LEVELS: readonly Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

/**
 * The gap list (T38): core lemmas at one level never met in a read sentence
 * and not in the bank — the actionable half of the coverage meter. Each row
 * shows the reference translation when the list carries one.
 */
export function CoreGapsScreen() {
  const params = useLocalSearchParams<{ level?: string }>();
  const level: Cefr = LEVELS.includes(params.level as Cefr) ? (params.level as Cefr) : 'A1';
  const gaps = useCoreGaps(level);

  const n = gaps.data?.length;
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (n == null || opened.current) return;
    opened.current = true;
    track('core_gaps_opened', { level, gaps: n });
  }, [n, level]);

  if (gaps.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator />
      </View>
    );
  }
  if (gaps.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void gaps.refetch()} />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-bg"
      data={gaps.data}
      keyExtractor={(g, i) => `${g.lemma}|${g.pos ?? ''}|${i}`}
      contentContainerClassName="px-4 pb-16 pt-4"
      initialNumToRender={30}
      ListHeaderComponent={
        <Text variant="caption" className="mb-3">
          {gaps.data.length} core {level} words you haven’t met in a story or collected yet.
        </Text>
      }
      ListEmptyComponent={
        <Text variant="muted" className="py-12 text-center">
          Every core {level} word is met — отлично.
        </Text>
      }
      renderItem={({ item }) => (
        <View className="flex-row items-baseline gap-3 border-b border-border py-2">
          <Text className="font-reading text-base">{item.lemma}</Text>
          {item.pos ? <Text variant="caption">{item.pos}</Text> : null}
          <Text variant="caption" className="flex-1 text-right" numberOfLines={1}>
            {item.translation ?? ''}
          </Text>
        </View>
      )}
    />
  );
}
