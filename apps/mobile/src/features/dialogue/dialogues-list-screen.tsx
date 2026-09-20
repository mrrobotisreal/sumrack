import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useDialogues, usePackClassification } from '@/db/hooks';
import type { DialogueListItem } from '@/db/repositories/dialogues';
import { classificationEventProps } from '@/features/library/categories';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Installed dialogues (T27 entry point behind the games-menu card): level
 * chip, endings-collected badge, finished-run marker. Empty state points at
 * content sync — dialogue packs arrive like any pack.
 */
export function DialoguesListScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const dialogues = useDialogues();
  // M14 (T46): dialogue_opened carries category/genre (stories/none unless authored).
  const classification = usePackClassification();

  useFocusEffect(
    React.useCallback(() => {
      track('dialogues_list_opened');
    }, []),
  );

  if (dialogues.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (dialogues.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void dialogues.refetch()} />
      </View>
    );
  }

  const items = dialogues.data ?? [];

  if (items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-10">
        <Ionicons name="chatbubbles-outline" size={40} color={theme.textMuted} />
        <Text className="font-reading-bold text-xl">Пока тихо</Text>
        <Text variant="muted" className="text-center">
          No dialogue packs installed yet. They arrive through content sync like any pack — pull to
          refresh in Библиотека.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-bg"
      data={items}
      keyExtractor={(item) => `${item.packId}/${item.id}`}
      contentContainerClassName="gap-2 px-4 pb-12 pt-4"
      renderItem={({ item }) => (
        <DialogueRow
          item={item}
          onPress={() => {
            track('dialogue_opened', {
              packId: item.packId,
              dialogueId: item.id,
              from: 'games',
              ...classificationEventProps(
                classification.get(item.packId) ?? { category: 'stories', genre: null },
              ),
            });
            router.push(`/dialogue/${item.packId}/${item.id}`);
          }}
        />
      )}
    />
  );
}

export function DialogueRow({ item, onPress }: { item: DialogueListItem; onPress: () => void }) {
  const { tokens: theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Play dialogue ${item.titleRu}`}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 active:bg-surface-2"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-2">
        <Ionicons name="chatbubbles-outline" size={19} color={theme.accent} />
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 font-reading text-base" numberOfLines={1}>
            {item.titleRu}
          </Text>
          {item.finishedRunCount > 0 && (
            <Ionicons name="checkmark-circle" size={16} color={theme.accent} />
          )}
        </View>
        <Text variant="caption" numberOfLines={1}>
          {item.titleEn} · Концовки: {item.endingsSeenCount}/{item.endingCount}
        </Text>
      </View>
      <LevelChip level={item.level} />
    </Pressable>
  );
}
