import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { CourseCard, CourseUnit, LibraryQuote } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { TokenRow } from '@/db/repositories/content';
import { repos } from '@/db';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { useCourseFloor, useLessonPositions, useLessonSentences } from '../hotel-hooks';
import { CardPages } from './card-pages';
import { cardProgress, clampCard, lessonKey, resumeIndex } from './lesson-model';

/**
 * The lesson (T90 decision 1): one card per page, the progress bar, resume at
 * the last card, the library quotes to the reader, and the «Начать
 * упражнения» / «Ещё раз с начала» finale. Long cards scroll inside a page.
 */
export function LessonScreen({ packId, unitId }: { packId: string; unitId: string }) {
  const { tokens: theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ card?: string }>();
  const cardParam = params.card !== undefined ? Number.parseInt(params.card, 10) : Number.NaN;
  const floor = useCourseFloor(packId);
  const unit: CourseUnit | null = floor.data?.course.units.find((u) => u.id === unitId) ?? null;
  const quotes = React.useMemo(
    () =>
      (unit?.cards ?? []).flatMap((c): LibraryQuote[] => (c.kind === 'library' ? c.quotes : [])),
    [unit],
  );
  const sentences = useLessonSentences(packId, unit, quotes);
  const lessonPos = useLessonPositions();
  // The learner's own move (null = not moved yet, so the saved position decides).
  // A `?card=` deep link (the runner's «Открыть карточку урока») wins over the saved position.
  const [moved, setMoved] = React.useState<number | null>(
    Number.isNaN(cardParam) ? null : cardParam,
  );
  const [popup, setPopup] = React.useState<WordPopupTarget | null>(null);
  const viewed = React.useRef(new Set<string>());

  // Resume at the saved card once read; a fresh unit starts at 0.
  const resumed = unit && lessonPos.loaded ? resumeIndex(lessonPos.positions, packId, unit) : 0;
  const count = unit?.cards.length ?? 0;
  const current = clampCard(moved ?? resumed, count);

  React.useEffect(() => {
    if (unit) track('hotel_unit_opened', { packId, unitId: unit.id });
  }, [unit, packId]);

  const card: CourseCard | undefined = unit?.cards[current];

  React.useEffect(() => {
    if (!unit || !card) return;
    lessonPos.save(lessonKey(packId, unit.id), current);
    const key = `${current}:${card.id}`;
    if (!viewed.current.has(key)) {
      viewed.current.add(key);
      track('hotel_card_viewed', { packId, unitId: unit.id, cardId: card.id, kind: card.kind });
    }
    // Save and count per card visit only; `lessonPos.save` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, unit, card, packId]);

  const onWordPress = React.useCallback((token: TokenRow, storyId: string, sentenceId: string) => {
    setPopup({ token, sentenceId, storyId, eventProps: undefined });
  }, []);

  const go = (next: number) => setMoved(clampCard(next, count));
  const last = count > 0 && current === count - 1;

  return (
    <View className="flex-1 bg-bg" testID="lesson-screen">
      <Stack.Screen options={{ title: unit?.title.ru ?? 'Урок' }} />
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-3">
        <Pressable
          onPress={() => router.replace('/hotel' as never)}
          accessibilityRole="button"
          accessibilityLabel="Закрыть урок"
          testID="lesson-close"
          className="h-11 w-11 items-center justify-center active:opacity-70"
        >
          <Ionicons name="close" size={24} color={theme.text} />
        </Pressable>
        <View className="flex-1">
          <View className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <View
              testID="lesson-progress"
              className="h-1.5 rounded-full bg-accent"
              style={{ width: `${Math.round(cardProgress(current, count) * 100)}%` }}
            />
          </View>
          <Text variant="caption" className="mt-1">
            {count > 0 ? `${current + 1} из ${count}` : ''}
          </Text>
        </View>
      </View>

      {card && unit ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-6 px-4 pb-10 pt-4"
          testID="lesson-page"
        >
          <CardPages
            packId={packId}
            unit={unit}
            card={card}
            sentences={sentences.data?.sentences ?? new Map()}
            sourceTitles={sentences.data?.sourceTitles ?? new Map()}
            onWordPress={onWordPress}
            onReadMore={(q) => void openQuoteInReader(router, q)}
            onQuotePlayed={(q) =>
              track('hotel_library_quote_played', { packId: q.packId, storyId: q.storyId })
            }
          />
          <View className="flex-row items-center justify-between gap-3 pt-4">
            <Pressable
              onPress={() => go(current - 1)}
              disabled={current === 0}
              accessibilityRole="button"
              accessibilityLabel="Назад"
              testID="lesson-prev"
              className="rounded-xl border border-border px-5 py-3 active:bg-surface-2"
              style={{ opacity: current === 0 ? 0.4 : 1 }}
            >
              <Text className="font-ui-medium">← Назад</Text>
            </Pressable>
            {last ? null : (
              <Pressable
                onPress={() => go(current + 1)}
                accessibilityRole="button"
                testID="lesson-next"
                className="flex-1 items-center rounded-xl bg-accent px-5 py-3 active:opacity-80"
              >
                <Text className="font-ui-medium text-bg">Далее →</Text>
              </Pressable>
            )}
          </View>
          {last ? (
            <View className="gap-3 pt-2">
              <Text className="font-ui-medium text-base">Урок пройден? Проверим.</Text>
              <Pressable
                onPress={() => router.push(`/hotel/${packId}/${unit.id}/practice` as never)}
                accessibilityRole="button"
                testID="lesson-start-exercises"
                className="items-center rounded-xl bg-accent py-3.5 active:opacity-80"
              >
                <Text className="font-ui-medium text-bg">Начать упражнения</Text>
              </Pressable>
              <Pressable
                onPress={() => go(0)}
                accessibilityRole="button"
                testID="lesson-restart"
                className="items-center rounded-xl border border-border py-3.5 active:bg-surface-2"
              >
                <Text className="font-ui-medium">Ещё раз с начала</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="muted">{floor.isLoading ? 'Загрузка…' : 'Урок не найден.'}</Text>
        </View>
      )}

      <WordPopup target={popup} onClose={() => setPopup(null)} />
    </View>
  );
}

/**
 * «читать дальше →» (T90 decision 1): the reader opens at the quoted sentence.
 * The reader's deep link takes the sentence's ORDER index, so resolve the id
 * first; if the source story is not installed, the link is a no-op.
 */
async function openQuoteInReader(
  router: { push: (href: never) => void },
  quote: LibraryQuote,
): Promise<void> {
  const detail = await repos.content.getStoryDetail(quote.packId, quote.storyId);
  const sentence = detail?.sentences.find((s) => s.id === quote.sentenceId);
  if (!sentence) return;
  router.push(`/reader/${quote.packId}/${quote.storyId}?sentenceIdx=${sentence.orderIdx}` as never);
}
