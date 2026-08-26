import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { DialogueEndingRow, DialogueGraph } from '@/db/repositories/dialogues';
import { useAppTheme } from '@/theme/use-app-theme';

import { type TranscriptEntry } from './engine';

/**
 * Ending screen (T27, V2 §3.3): ending title + recap (RU with reveal-EN,
 * the sentence-reveal pattern), the path recap (answers chosen), and the
 * collected state «Концовки: N/M» with unseen endings masked. Restrained —
 * the toast already celebrated; this screen is the record.
 */

const TONE_ICON: Record<DialogueEndingRow['tone'], React.ComponentProps<typeof Ionicons>['name']> =
  {
    good: 'checkmark-circle-outline',
    bad: 'skull-outline',
    strange: 'eye-outline',
  };

const TONE_LABEL: Record<DialogueEndingRow['tone'], string> = {
  good: 'Хорошая концовка',
  bad: 'Плохая концовка',
  strange: 'Странная концовка',
};

export function EndingView({
  graph,
  ending,
  entries,
  onRestart,
  onClose,
}: {
  graph: DialogueGraph;
  ending: DialogueEndingRow;
  entries: TranscriptEntry[];
  onRestart: () => void;
  onClose: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const [showEn, setShowEn] = React.useState(false);

  const dialogueId = graph.dialogue.id;
  const seen = useQuery({
    queryKey: ['dialogue-endings-seen', dialogueId],
    queryFn: () => repos.dialogues.listEndingsSeen(dialogueId),
  });
  const seenIds = React.useMemo(() => {
    const ids = new Set((seen.data ?? []).map((row) => row.endingId));
    // The just-reached ending counts even before the query refetches.
    ids.add(ending.id);
    return ids;
  }, [seen.data, ending.id]);

  const chosen = entries.filter((e) => e.kind === 'choice');

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-6 pb-12 pt-10">
      <View className="items-center gap-2">
        <Ionicons name={TONE_ICON[ending.tone]} size={44} color={theme.accent} />
        <Text variant="caption" className="uppercase tracking-wider">
          {TONE_LABEL[ending.tone]}
        </Text>
        <RNText className="text-center font-reading text-3xl text-text">{ending.titleRu}</RNText>
        <Text variant="muted">{ending.titleEn}</Text>
      </View>

      {/* recap with reveal-EN (sentence-reveal pattern) */}
      <Pressable
        onPress={() => setShowEn((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={showEn ? 'Hide translation' : 'Show translation'}
        accessibilityState={{ expanded: showEn }}
        className="mt-6 rounded-xl border border-border bg-surface p-4"
      >
        <View className="flex-row items-start gap-2">
          <RNText className="flex-1 font-reading text-lg leading-7 text-text">
            {ending.recapRu}
          </RNText>
          <Ionicons
            name={showEn ? 'language' : 'language-outline'}
            size={16}
            color={showEn ? theme.accent : theme.border}
          />
        </View>
        {showEn && (
          <RNText className="mt-2 border-l-2 border-accent/40 pl-3 font-reading-italic text-base text-text-muted">
            {ending.recapEn}
          </RNText>
        )}
      </Pressable>

      {/* path recap */}
      {chosen.length > 0 && (
        <View className="mt-6">
          <Text variant="caption" className="mb-2 uppercase tracking-wider">
            Твой путь
          </Text>
          <View className="gap-1.5">
            {chosen.map((entry) =>
              entry.kind === 'choice' ? (
                <View key={entry.key} className="flex-row items-center gap-2">
                  <Ionicons
                    name={entry.score !== undefined ? 'mic-outline' : 'hand-left-outline'}
                    size={13}
                    color={theme.textMuted}
                  />
                  <RNText className="flex-1 font-reading text-base text-text" numberOfLines={2}>
                    {entry.choice.sentence?.ru ?? '…'}
                  </RNText>
                  {entry.score !== undefined && (
                    <Text variant="caption">{Math.round(entry.score)}%</Text>
                  )}
                </View>
              ) : null,
            )}
          </View>
        </View>
      )}

      {/* endings collected */}
      <View className="mt-6">
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          Концовки: {seenIds.size}/{graph.endings.length}
        </Text>
        <View className="gap-1.5">
          {graph.endings.map((e) => {
            const isSeen = seenIds.has(e.id);
            return (
              <View key={e.id} className="flex-row items-center gap-2">
                <Ionicons
                  name={isSeen ? TONE_ICON[e.tone] : 'help-circle-outline'}
                  size={15}
                  color={isSeen ? theme.accent : theme.border}
                />
                <Text className={isSeen ? '' : 'text-text-muted'}>
                  {isSeen ? e.titleRu : '???'}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={onRestart}
        accessibilityRole="button"
        className="mt-8 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80"
      >
        <Ionicons name="refresh" size={16} color={theme.bg} />
        <Text className="font-ui-medium text-bg">Пройти ещё раз</Text>
      </Pressable>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        className="mt-3 items-center justify-center rounded-xl border border-border bg-surface py-3.5 active:bg-surface-2"
      >
        <Text className="font-ui-medium">Готово</Text>
      </Pressable>
    </ScrollView>
  );
}
