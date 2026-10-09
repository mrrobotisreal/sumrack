import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, SectionList, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { useAppTheme } from '@/theme/use-app-theme';

import { useExamTexts } from './hooks';
import type { TorflLevel } from './level-profile';
import { TextRow } from './text-row';
import { SUBTEST_LABELS } from './topics';

/**
 * «Тексты» (T69, TORFL §5.3): every passage / listening script / examiner
 * line / model answer across the installed exam packs, grouped by subtest
 * (the subtest of the first item that references the story). Each row
 * opens the ordinary reader — lookup, karaoke and bank work as anywhere.
 */
export function TorflTextsScreen({ level = 'A1' }: { level?: TorflLevel }) {
  const { tokens } = useAppTheme();
  useStudyAmbience(true, 'education');
  const { groups, isPending } = useExamTexts(level);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (groups.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-10">
        <Ionicons name="documents-outline" size={40} color={tokens.textMuted} />
        <Text className="font-reading-bold text-xl">Пока пусто</Text>
        <Text variant="muted" className="text-center">
          Тексты для чтения и аудирования появятся вместе с экзаменами после синхронизации.
        </Text>
      </View>
    );
  }
  return (
    <SectionList
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-12 pt-2"
      stickySectionHeadersEnabled={false}
      sections={groups.map((g) => ({ kind: g.kind, data: g.texts }))}
      keyExtractor={(t) => `${t.packId}/${t.storyId}`}
      renderSectionHeader={({ section }) => (
        <View className="mb-2 mt-5 flex-row items-center gap-2 px-1">
          <Ionicons name={SUBTEST_LABELS[section.kind].icon} size={15} color={tokens.textMuted} />
          <Text variant="caption" className="font-ui-medium uppercase tracking-wider">
            {SUBTEST_LABELS[section.kind].ru} · {section.data.length}
          </Text>
        </View>
      )}
      renderItem={({ item }) => <TextRow text={item} from="texts" />}
    />
  );
}
