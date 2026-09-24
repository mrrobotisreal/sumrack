import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useLessonsForSection } from '@/db/hooks';
import type { BankItemRow } from '@/db/repositories/bank';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatLessonRow } from './format';

/**
 * «Lessons · N» sheet (WORD_FORMS §7.3): every lesson stored for one word ×
 * one section, newest first, one receipt row each → `/lessons/[id]`.
 * Read-only — lessons are never edited or deleted in M16.
 */
export function LessonsListSheet({
  open,
  item,
  sectionId,
  title,
  onClose,
}: {
  open: boolean;
  item: BankItemRow;
  sectionId: string;
  /** Section title (en) for the sheet header. */
  title: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const lessons = useLessonsForSection(open ? item : null, sectionId);
  const rows = lessons.data ?? [];

  const openLesson = React.useCallback(
    (id: string) => {
      onClose();
      track('lesson_opened', { from: 'sheet' });
      router.push({ pathname: '/lessons/[id]', params: { id } });
    },
    [onClose, router],
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />

      <View
        className="rounded-t-2xl border-t border-border bg-surface px-5 pb-10 pt-4"
        style={{ maxHeight: '70%' }}
      >
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="font-ui-medium text-lg">Lessons · {rows.length}</Text>
            <Text variant="caption" numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close lessons sheet">
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        {lessons.isPending ? (
          <View className="items-center py-6">
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator>
            <View className="overflow-hidden rounded-xl border border-border">
              {rows.map((row, i) => (
                <Pressable
                  key={row.id}
                  onPress={() => openLesson(row.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Lesson ${rows.length - i}`}
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
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
