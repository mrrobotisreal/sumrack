import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { QueryErrorScreen } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useCurrentProfile, useLesson } from '@/db/hooks';
import { isOnline } from '@/features/ai/connectivity';
import { GenerateSheet } from '@/features/ai/generate-sheet';
import { PROVIDER_LABELS } from '@/features/ai/run-profile';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatLessonReceipt, sectionTitleById } from './format';
import { useLearn } from './use-learn';

/**
 * One saved grammar lesson (WORD_FORMS §7.3, route `app/lessons/[id]`):
 * header = headword + section title; the receipt line («effort n/a» when the
 * param was rejected, §8); the markdown body (tables render through
 * `lib/markdown`); footer **Learn again** (same section, Generate sheet →
 * a NEW lesson — append-only) and **Open word** (→ `/word-bank/[id]?tab=forms`
 * resolved through the profile key, because lessons outlive bank rows —
 * a deleted word disables the button with «Word not in bank»). Never
 * editable, never deletable in M16. Renders fully offline.
 */
export function LessonScreen({ id }: { id: string }) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const lesson = useLesson(id);
  const row = lesson.data ?? null;

  // The bank item behind the key (null = deleted since) and its CURRENT
  // profile (Learn again grounds itself in the current version, §7.3).
  const bankItem = useQuery({
    queryKey: ['bank-item-by-key', row?.lemmaNorm ?? '', row?.kind ?? 'word'],
    queryFn: () => repos.bank.findByProfileKey(row!.lemmaNorm, row!.kind),
    enabled: row !== null,
  });
  const item = bankItem.data ?? null;
  const current = useCurrentProfile(item);
  const profile = current.data?.profile ?? null;
  const section = React.useMemo(
    () => profile?.sections.find((s) => s.id === row?.sectionId) ?? null,
    [profile, row?.sectionId],
  );

  const { state: learn, learn: runLearn, dismiss } = useLearn('lesson');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    void isOnline().then((up) => {
      if (!cancelled) setOnline(up);
    });
    return () => {
      cancelled = true;
    };
  }, [learn.phase]);

  if (lesson.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <Stack.Screen options={{ title: 'Lesson' }} />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (lesson.isError || !row) {
    return (
      <>
        <Stack.Screen options={{ title: 'Lesson' }} />
        <QueryErrorScreen
          message={lesson.isError ? undefined : 'This lesson no longer exists.'}
          onRetry={() => void lesson.refetch()}
        />
      </>
    );
  }

  const title = sectionTitleById(row.sectionId, profile);
  const busy = learn.phase === 'loading';
  // Learn again needs the word in the bank, a readable current profile
  // that still carries this section, and connectivity.
  const canLearnAgain = !!item && !!current.data && !!section && online && !busy;
  const learnAgainReason = !online
    ? 'Offline — connect to learn'
    : !item
      ? 'Word not in bank'
      : current.isPending
        ? undefined
        : !current.data
          ? 'No current profile'
          : !section
            ? 'Section not in the current profile'
            : undefined;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: row.headword }} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-32 pt-5"
        showsVerticalScrollIndicator
      >
        {/* header: headword + section title */}
        <RNText className="font-reading text-3xl leading-10 text-text" accessibilityRole="header">
          {row.headword}
        </RNText>
        <Text className="mt-0.5 font-ui-medium text-lg">{title.en}</Text>
        <Text variant="caption" className="text-xs">
          {title.ru}
        </Text>

        {/* receipt line (§7.3) */}
        <Text variant="caption" className="mt-3 text-xs" accessibilityLabel="Receipt">
          {formatLessonReceipt(row)}
        </Text>

        <View className="mt-5">
          <MarkdownView source={row.markdown} />
        </View>
      </ScrollView>

      {/* footer: Learn again + Open word */}
      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-surface px-5 pb-8 pt-3">
        {learn.phase === 'error' && (
          <View className="mb-2 flex-row items-center gap-3">
            <Text variant="caption" className="flex-1 text-xs">
              {learn.message}
            </Text>
            <Pressable
              onPress={() => item && section && runLearn(item, current.data!, section, learn.run)}
              accessibilityRole="button"
              accessibilityLabel="Retry lesson"
              className="rounded-lg bg-accent px-3 py-1.5 active:opacity-80"
            >
              <Text className="font-ui-medium text-xs">Retry</Text>
            </Pressable>
            <Pressable
              onPress={dismiss}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Dismiss lesson error"
            >
              <Ionicons name="close" size={16} color={theme.textMuted} />
            </Pressable>
          </View>
        )}
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => setSheetOpen(true)}
            disabled={!canLearnAgain}
            accessibilityRole="button"
            accessibilityLabel={
              learnAgainReason ? `Learn again, ${learnAgainReason.toLowerCase()}` : 'Learn again'
            }
            accessibilityState={{ disabled: !canLearnAgain, busy }}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2.5 ${
              canLearnAgain ? 'bg-accent active:opacity-80' : 'bg-surface-2'
            }`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.text} />
            ) : (
              <Ionicons
                name="sparkles-outline"
                size={15}
                color={canLearnAgain ? theme.text : theme.textMuted}
              />
            )}
            <Text
              className={`font-ui-medium text-sm ${canLearnAgain ? 'text-text' : 'text-text-muted'}`}
              numberOfLines={1}
            >
              {busy
                ? `Asking ${PROVIDER_LABELS[learn.run.provider]}…`
                : (learnAgainReason ?? 'Learn again')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              item &&
              router.push({
                pathname: '/word-bank/[id]',
                params: { id: item.id, tab: 'forms' },
              })
            }
            disabled={!item}
            accessibilityRole="button"
            accessibilityLabel={item ? 'Open word' : 'Open word, word not in bank'}
            accessibilityState={{ disabled: !item }}
            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border py-2.5 ${
              item ? 'border-border bg-surface-2 active:bg-border' : 'border-border opacity-50'
            }`}
          >
            <Ionicons name="book-outline" size={15} color={item ? theme.text : theme.textMuted} />
            <Text
              className={`font-ui-medium text-sm ${item ? 'text-text' : 'text-text-muted'}`}
              numberOfLines={1}
            >
              {item ? 'Open word' : 'Word not in bank'}
            </Text>
          </Pressable>
        </View>
      </View>

      <GenerateSheet
        open={sheetOpen}
        purpose="lesson"
        title={`Learn: ${title.en}`}
        onClose={() => setSheetOpen(false)}
        onGenerate={(run) => {
          setSheetOpen(false);
          if (item && current.data && section) runLearn(item, current.data, section, run);
        }}
      />
    </View>
  );
}
