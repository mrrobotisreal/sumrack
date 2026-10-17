import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { Text } from '@/components/ui/text';
import { useOnline } from '@/features/ai/connectivity';
import { useAppTheme } from '@/theme/use-app-theme';

import type { Verdict } from './runner-model';

/**
 * The feedback sheet after EVERY answer in unit and check mode (T90 decision 4):
 * the verdict, the correct sentence (with its ▶), the explanation (always —
 * right or wrong), the learner's choice named when wrong, and the actions:
 * «Объясни ещё ✦», «Открыть карточку урока» (unit only), «Далее →».
 */
export function FeedbackPanel({
  verdict,
  chosenText,
  correctSentence,
  explain,
  playCorrect,
  onExplainMore,
  onOpenCard,
  onNext,
  nextLabel = 'Далее →',
}: {
  verdict: Verdict;
  /** The learner's pick, named when it was wrong («Вы выбрали «в театре»»). */
  chosenText?: string;
  /** The correct sentence: the answer filled into the stem, or the voiced sentence. */
  correctSentence: string;
  explain: string;
  playCorrect?: () => void;
  onExplainMore?: () => void;
  /** Present on a unit run only (decision 4). */
  onOpenCard?: () => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  const online = useOnline();
  const { tokens: theme } = useAppTheme();
  const ok = verdict === 'full';
  const half = verdict === 'half';
  const icon = ok ? 'checkmark-circle' : half ? 'remove-circle' : 'close-circle';
  const color = ok ? theme.success : half ? theme.trackWarm : theme.danger;
  const label = ok ? 'Верно' : half ? 'Почти' : 'Неверно';
  return (
    <View
      className="gap-4 rounded-2xl border border-border bg-surface px-4 py-4"
      testID="feedback-panel"
    >
      <View className="flex-row items-center gap-2" accessibilityLabel={`Ответ: ${label}`}>
        <Ionicons name={icon} size={22} color={color} />
        <Text className="font-ui-bold text-base" testID="feedback-verdict">
          {label}
        </Text>
      </View>
      {!ok && chosenText ? (
        <Text variant="muted" testID="feedback-chosen">
          {`Вы выбрали «${chosenText}»`}
        </Text>
      ) : null}
      <View className="gap-2 rounded-xl bg-surface-2 px-4 py-3">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 font-reading text-lg" testID="feedback-correct">
            {correctSentence}
          </Text>
          {playCorrect ? (
            <Pressable
              onPress={playCorrect}
              accessibilityRole="button"
              accessibilityLabel="Прослушать правильный ответ"
              testID="feedback-play"
              className="h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-80"
            >
              <Ionicons name="play" size={18} color={theme.accent} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <MarkdownView source={explain} />
      <View className="flex-row flex-wrap gap-2">
        {onExplainMore ? (
          <Pressable
            onPress={onExplainMore}
            disabled={!online}
            accessibilityRole="button"
            accessibilityState={{ disabled: !online }}
            testID="feedback-explain-more"
            className="rounded-xl border border-border px-4 py-2.5 active:bg-surface-2"
            style={{ opacity: online ? 1 : 0.45 }}
          >
            <Text className="font-ui-medium text-sm">
              {online ? 'Объясни ещё ✦' : 'Объясни ещё ✦ · нужен интернет'}
            </Text>
          </Pressable>
        ) : null}
        {onOpenCard ? (
          <Pressable
            onPress={onOpenCard}
            accessibilityRole="button"
            testID="feedback-open-card"
            className="rounded-xl border border-border px-4 py-2.5 active:bg-surface-2"
          >
            <Text className="font-ui-medium text-sm">Открыть карточку урока</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={onNext}
        accessibilityRole="button"
        testID="feedback-next"
        className="items-center rounded-xl bg-accent py-3.5 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">{nextLabel}</Text>
      </Pressable>
    </View>
  );
}
