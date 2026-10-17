import { Ionicons } from '@expo/vector-icons';
import type { SentenceWithTokens, TokenRow } from '@/db/repositories/content';
import type { CourseCard, CourseExample, LibraryQuote } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { Text } from '@/components/ui/text';
import type { ExamAudio } from '@/features/torfl/items/exam-audio';
import { useAppTheme } from '@/theme/use-app-theme';

import { ExampleRow } from './example-row';
import { TableGrid } from './table-grid';
import type { SentenceRefKey } from './lesson-model';

/** Resolved examples: the sentence + its narration span, keyed by `storyId/sentenceId`. */
export interface ResolvedSentence {
  sentence: SentenceWithTokens | null;
  audio: ExamAudio | null;
}
export type SentenceMap = Map<SentenceRefKey, ResolvedSentence>;

export interface CardCallbacks {
  onWordPress: (token: TokenRow, sentenceId: string) => void;
  /** Library quote: open the reader at the sentence. */
  onReadMore: (quote: LibraryQuote) => void;
  onQuotePlayed: (quote: LibraryQuote) => void;
}

function ExampleList({
  examples,
  sentences,
  cb,
}: {
  examples: CourseExample[];
  sentences: SentenceMap;
  cb: CardCallbacks;
}) {
  return (
    <View className="gap-3">
      {examples.map((ex, i) => {
        const key = `${ex.sentenceRef.storyId}/${ex.sentenceRef.sentenceId}` as SentenceRefKey;
        const resolved = sentences.get(key);
        if (!resolved?.sentence) return null;
        return (
          <ExampleRow
            key={`${key}-${i}`}
            sentence={resolved.sentence}
            highlight={ex.highlight}
            why={ex.why}
            audio={resolved.audio}
            onWordPress={cb.onWordPress}
          />
        );
      })}
    </View>
  );
}

export function ExplainCardView({
  card,
  sentences,
  cb,
}: {
  card: Extract<CourseCard, { kind: 'explain' }>;
  sentences: SentenceMap;
  cb: CardCallbacks;
}) {
  return (
    <View className="gap-5">
      <View className="gap-1">
        <Text variant="heading" className="font-ui-bold text-2xl">
          {card.title.ru}
        </Text>
        <Text variant="caption">{card.title.en}</Text>
      </View>
      <MarkdownView source={card.body} />
      {card.table ? <TableGrid table={card.table} /> : null}
      <View className="gap-3">
        <Text className="font-ui-medium text-sm text-text-muted">Примеры</Text>
        <ExampleList examples={card.examples} sentences={sentences} cb={cb} />
      </View>
    </View>
  );
}

export function EdgeCardView({
  card,
  sentences,
  cb,
}: {
  card: Extract<CourseCard, { kind: 'edge' }>;
  sentences: SentenceMap;
  cb: CardCallbacks;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="gap-5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="sparkles-outline" size={18} color={theme.accent} />
        <View className="rounded-full bg-accent-soft px-2.5 py-0.5">
          <Text className="font-ui-medium text-xs text-accent">Тонкость</Text>
        </View>
      </View>
      <Text variant="heading" className="font-ui-bold text-2xl">
        {card.title.ru}
      </Text>
      <MarkdownView source={card.body} />
      <ExampleList examples={card.examples} sentences={sentences} cb={cb} />
    </View>
  );
}

export function TrapsCardView({
  card,
  sentences,
  cb,
}: {
  card: Extract<CourseCard, { kind: 'traps' }>;
  sentences: SentenceMap;
  cb: CardCallbacks;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="gap-4">
      <Text variant="heading" className="font-ui-bold text-2xl">
        {card.title.ru}
      </Text>
      {card.pairs.map((pair, i) => {
        const key = `${pair.right.storyId}/${pair.right.sentenceId}` as SentenceRefKey;
        const right = sentences.get(key);
        return (
          <View
            key={i}
            className="gap-2 rounded-xl border border-border bg-surface px-4 py-3"
            testID="trap-pair"
          >
            <View className="flex-row items-start gap-2">
              <Ionicons name="close-circle" size={18} color={theme.danger} />
              <Text className="flex-1 font-reading text-lg text-text-muted line-through">
                {pair.wrong}
              </Text>
            </View>
            {right?.sentence ? (
              <View className="flex-row items-start gap-2">
                <Ionicons name="checkmark-circle" size={18} color={theme.success} />
                <View className="flex-1">
                  <ExampleRow
                    sentence={right.sentence}
                    highlight={[]}
                    audio={right.audio}
                    onWordPress={cb.onWordPress}
                  />
                </View>
              </View>
            ) : null}
            <Text variant="muted" className="leading-6">
              {pair.reason}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function LibraryCardView({
  card,
  sentences,
  sourceTitles,
  cb,
}: {
  card: Extract<CourseCard, { kind: 'library' }>;
  sentences: SentenceMap;
  /** `packId/storyId` → «story, pack» line; absent = the source pack is not installed. */
  sourceTitles: Map<string, string>;
  cb: CardCallbacks;
}) {
  return (
    <View className="gap-4">
      <Text variant="heading" className="font-ui-bold text-2xl">
        Из библиотеки
      </Text>
      {card.quotes.map((q, i) => {
        const source = sourceTitles.get(`${q.packId}/${q.storyId}`);
        const key = `${q.storyId}/${q.sentenceId}` as SentenceRefKey;
        const resolved = sentences.get(key);
        return (
          <View
            key={i}
            className="gap-2 rounded-xl border border-border bg-surface px-4 py-3"
            testID="library-quote"
          >
            {resolved?.sentence ? (
              <ExampleRow
                sentence={resolved.sentence}
                highlight={q.highlight}
                why={q.why}
                audio={resolved.audio}
                onWordPress={cb.onWordPress}
                onPlay={() => cb.onQuotePlayed(q)}
              />
            ) : (
              <Text className="font-reading text-lg">{q.text}</Text>
            )}
            <Text variant="caption">{source ? `— ${source}` : `— ${q.packId}`}</Text>
            <Pressable
              onPress={() => cb.onReadMore(q)}
              accessibilityRole="button"
              testID="library-read-more"
              className="self-start active:opacity-80"
            >
              <Text className="font-ui-medium text-sm text-accent">читать дальше →</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
