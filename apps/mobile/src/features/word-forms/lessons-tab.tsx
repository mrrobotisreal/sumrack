import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useCurrentProfile, useLessonsForKey } from '@/db/hooks';
import type { BankItemRow } from '@/db/repositories/bank';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatLessonRow, sectionRank, sectionTitleById } from './format';
import { groupBySection } from './lesson-core';
import { profileKeyFor } from './profile-core';

/**
 * The item's Lessons tab (WORD_FORMS §7.3): every lesson stored for the
 * word's key, grouped by section in catalog order, newest first inside a
 * section → `/lessons/[id]`. Generation lives on the Forms tab (Learn per
 * section) — this tab only reads, so it works fully offline.
 */
export function LessonsTab({ item }: { item: BankItemRow }) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const key = React.useMemo(() => profileKeyFor(item), [item]);
  const lessons = useLessonsForKey(item);
  const current = useCurrentProfile(item);
  const profile = current.data?.profile ?? null;
  const groups = React.useMemo(
    () => groupBySection(lessons.data ?? [], sectionRank),
    [lessons.data],
  );

  const open = React.useCallback(
    (id: string) => {
      track('lesson_opened', { from: 'item' });
      router.push({ pathname: '/lessons/[id]', params: { id } });
    },
    [router],
  );

  if (key !== null && lessons.isPending) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View className="mt-6 items-center gap-2 rounded-xl border border-border bg-surface px-6 py-10">
        <Ionicons name="school-outline" size={24} color={theme.textMuted} />
        <Text className="font-ui-medium">No lessons yet</Text>
        <Text variant="caption" className="text-center">
          {key
            ? 'Open the Forms tab and tap Learn on any section.'
            : 'Word forms are keyed by the lemma, so the word needs one before it can be taught.'}
        </Text>
      </View>
    );
  }

  return (
    <View className="mt-4 gap-3">
      {groups.map((group) => {
        const title = sectionTitleById(group.sectionId, profile);
        return (
          <View
            key={group.sectionId}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <View className="border-b border-border px-4 py-3">
              <Text className="font-ui-medium">{title.en}</Text>
              <Text variant="caption" className="text-xs">
                {title.ru} · {group.rows.length}
              </Text>
            </View>
            {group.rows.map((row, i) => (
              <Pressable
                key={row.id}
                onPress={() => open(row.id)}
                accessibilityRole="button"
                accessibilityLabel={`${title.en} lesson ${group.rows.length - i}`}
                className={`flex-row items-center gap-3 px-4 py-3 active:bg-surface-2 ${
                  i > 0 ? 'border-t border-border' : ''
                }`}
              >
                <Ionicons name="school-outline" size={18} color={theme.textMuted} />
                <Text className="flex-1 text-sm">{formatLessonRow(row)}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}
