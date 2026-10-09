import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import type { FeedbackStatus } from '@/db/schema';
import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { FeedbackBadge } from '@/features/journal/feedback-badge';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { ruPlural } from '../hub-model';
import type { TorflLevel } from '../level-profile';
import {
  rehearsalText,
  rehearseHref,
  type AnswerEntry,
  type AnswerPromptGroup,
  type AnswerTopicGroup,
} from './answers-model';
import { useAnswers, useRefreshAnswersOnFocus } from './use-answers';

const ANSWERS = ['ответ', 'ответа', 'ответов'] as const;
const SENTENCES = ['предложение', 'предложения', 'предложений'] as const;

/**
 * «Мои ответы» (T74, TORFL §9) — route `/torfl/answers`: every installed
 * `torfl` journal prompt grouped by topic, each with Mitch's own entries
 * (newest first). «Написать ответ» opens the ordinary journal editor
 * pre-filled with the prompt (unchanged flow + AI feedback); every entry
 * has «Отрепетировать вслух» → the rehearsal screen. No prompts installed
 * → an empty state naming the pack that brings them.
 */
export function AnswersScreen({ level = 'A1' }: { level?: TorflLevel }) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useStudyAmbience(true, 'education');
  const answers = useAnswers(level);
  const refresh = useRefreshAnswersOnFocus();
  useFocusEffect(refresh);

  const write = React.useCallback(
    (promptId: string) => {
      track('journal_prompt_used', { promptId, from: 'torfl-answers' });
      router.push({ pathname: '/journal/[id]', params: { id: 'new', promptId } });
    },
    [router],
  );
  const open = React.useCallback(
    (entryId: string) => router.push({ pathname: '/journal/[id]', params: { id: entryId } }),
    [router],
  );
  const rehearse = React.useCallback(
    (entry: AnswerEntry, topic: string) => {
      const href = rehearseHref(entry.id, topic);
      router.push({ ...href, params: { ...href.params, level } });
    },
    [router, level],
  );

  if (answers.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (answers.isError || !answers.data) {
    return (
      <View className="flex-1 justify-center bg-bg px-6">
        <QueryError onRetry={() => void answers.refetch()} />
      </View>
    );
  }

  const { groups, promptCount, entryCount } = answers.data;

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="gap-6 px-4 pt-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
      testID="torfl-answers"
    >
      <View className="gap-1 rounded-2xl border border-border bg-surface px-4 py-4">
        <Text className="font-ui-bold text-lg">Мои ответы</Text>
        <Text variant="caption">
          Свои настоящие ответы на темы экзамена: напиши в журнале, получи правку, а потом
          отрепетируй вслух — с текстом и без.
        </Text>
        {promptCount > 0 ? (
          <Text variant="caption" className="mt-1">
            {promptCount} {ruPlural(promptCount, ['тема', 'темы', 'тем'])} · {entryCount}{' '}
            {ruPlural(entryCount, ANSWERS)}
          </Text>
        ) : null}
      </View>

      {groups.length === 0 ? (
        <View className="flex-row items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <Ionicons name="cloud-download-outline" size={18} color={tokens.textMuted} />
          <Text variant="muted" className="flex-1">
            Темы для ответов появятся после синхронизации (пакет «Мои ответы» с подсказками ТРКИ).
          </Text>
        </View>
      ) : (
        groups.map((g) => (
          <TopicSection
            key={g.topic}
            group={g}
            onWrite={write}
            onOpen={open}
            onRehearse={(e) => rehearse(e, g.topic)}
          />
        ))
      )}
    </ScrollView>
  );
}

function TopicSection({
  group,
  onWrite,
  onOpen,
  onRehearse,
}: {
  group: AnswerTopicGroup;
  onWrite: (promptId: string) => void;
  onOpen: (entryId: string) => void;
  onRehearse: (entry: AnswerEntry) => void;
}) {
  return (
    <View testID={`answers-topic-${group.topic}`}>
      <View className="mb-2.5 flex-row items-baseline justify-between px-1">
        <Text variant="caption" className="font-ui-medium uppercase tracking-wider">
          {group.labelRu}
        </Text>
        <Text variant="caption">
          {group.entryCount} {ruPlural(group.entryCount, ANSWERS)}
        </Text>
      </View>
      <View className="gap-2">
        {group.prompts.map((p) => (
          <PromptCard
            key={p.prompt.id}
            group={p}
            onWrite={() => onWrite(p.prompt.id)}
            onOpen={onOpen}
            onRehearse={onRehearse}
          />
        ))}
      </View>
    </View>
  );
}

function PromptCard({
  group,
  onWrite,
  onOpen,
  onRehearse,
}: {
  group: AnswerPromptGroup;
  onWrite: () => void;
  onOpen: (entryId: string) => void;
  onRehearse: (entry: AnswerEntry) => void;
}) {
  const { tokens } = useAppTheme();
  const { prompt, entries } = group;
  return (
    <View
      className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
      testID={`answers-prompt-${prompt.id}`}
    >
      <View className="gap-1">
        <Text className="font-reading text-base leading-6">{prompt.promptRu}</Text>
        <Text variant="caption">{prompt.promptEn}</Text>
      </View>

      {entries.map((e) => (
        <EntryRow
          key={e.id}
          entry={e}
          onOpen={() => onOpen(e.id)}
          onRehearse={() => onRehearse(e)}
        />
      ))}

      <Pressable
        onPress={onWrite}
        accessibilityRole="button"
        accessibilityLabel={`Написать ответ: ${prompt.promptRu}`}
        testID={`answers-write-${prompt.id}`}
        className="flex-row items-center justify-center gap-2 self-start rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
      >
        <Ionicons name="create-outline" size={14} color={tokens.accent} />
        <Text className="font-ui-medium text-sm text-accent">
          {entries.length === 0 ? 'Написать ответ' : 'Написать ещё'}
        </Text>
      </Pressable>
    </View>
  );
}

function EntryRow({
  entry,
  onOpen,
  onRehearse,
}: {
  entry: AnswerEntry;
  onOpen: () => void;
  onRehearse: () => void;
}) {
  const { tokens } = useAppTheme();
  const text = rehearsalText(entry);
  const when = new Date(entry.createdAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
  const n = text.sentences.length;
  return (
    <View
      className="gap-2 rounded-xl border border-border bg-bg px-3 py-3"
      testID={`answers-entry-${entry.id}`}
    >
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="Открыть запись">
        <Text className="font-reading text-base leading-6" numberOfLines={3}>
          {text.sentences.join(' ') || entry.ru}
        </Text>
        <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
          <Text variant="caption">
            {when} · {n} {ruPlural(n, SENTENCES)}
            {text.corrected ? ' · исправленный текст' : ''}
          </Text>
          <FeedbackBadge status={entry.feedbackStatus as FeedbackStatus} />
        </View>
      </Pressable>
      <Pressable
        onPress={onRehearse}
        disabled={n === 0}
        accessibilityRole="button"
        accessibilityLabel="Отрепетировать вслух"
        accessibilityState={{ disabled: n === 0 }}
        testID={`answers-rehearse-${entry.id}`}
        className={`flex-row items-center justify-center gap-2 rounded-xl py-2.5 ${
          n === 0 ? 'bg-surface-2' : 'bg-accent active:opacity-80'
        }`}
      >
        <Ionicons name="mic-outline" size={16} color={n === 0 ? tokens.textMuted : tokens.bg} />
        <Text className={`font-ui-medium ${n === 0 ? '' : 'text-bg'}`}>Отрепетировать вслух</Text>
      </Pressable>
    </View>
  );
}
