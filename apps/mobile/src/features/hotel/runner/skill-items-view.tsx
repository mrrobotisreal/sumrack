import type { WritingItem } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import {
  countersLine,
  writingCounters,
  writingChecklist,
} from '@/features/torfl/writing/writing-model';
import { gradeWritingOffline, type OfflineWritingGrade } from '@/features/torfl/grading/writing';
import { useAppTheme } from '@/theme/use-app-theme';

import type { ResponseEntry } from '@/db/repositories/course';

import type { RunMode } from './runner-model';
import { writingCorrect, writingResponse, WRITING_CORRECT_PCT } from './skill-items';

/**
 * A writing item inside a course run (T92d, decision 8). The task and its
 * bullets sit above a compact letter box; «Сдать» grades the text OFFLINE
 * (`gradeWritingOffline`, pure, no exam rows written) and stores the response
 * with its verdict (≥ 66 % = correct). The runner scores and saves that entry.
 *
 * Unit runs show the offline grade at once. Floor and экстерн runs take the
 * letter with no feedback (exam conditions), like the other items.
 */
export function WritingItemView({
  item,
  mode,
  stored,
  onAnswer,
}: {
  item: WritingItem;
  mode: RunMode;
  /** The response already stored for this item (a resumed sitting). */
  stored: ResponseEntry | undefined;
  onAnswer: (value: ResponseEntry) => void;
}) {
  const { tokens } = useAppTheme();
  const storedText =
    typeof (stored?.answer as { text?: unknown } | undefined)?.text === 'string'
      ? (stored!.answer as { text: string }).text
      : '';
  const [text, setText] = React.useState(storedText);
  const [grade, setGrade] = React.useState<OfflineWritingGrade | null>(null);
  const [submitted, setSubmitted] = React.useState(stored !== undefined);

  const counters = writingCounters(item, text);
  const checklist = writingChecklist(item, text);
  const empty = text.trim().length === 0;

  const submit = () => {
    const g = gradeWritingOffline(item, text);
    setGrade(g);
    setSubmitted(true);
    const entry = writingResponse(text, g.pct);
    onAnswer({ answer: entry.answer, correct: entry.correct });
  };

  // An edit reopens «Сдать» (the letter is re-graded on the next submit).
  const onEdit = (next: string) => {
    setText(next);
    if (submitted) setSubmitted(false);
  };

  return (
    <View className="gap-4" testID="skill-writing">
      <View className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4">
        <Text className="font-reading text-lg leading-7">{item.task.ru}</Text>
        <View className="mt-1 gap-1.5">
          {checklist.map((row) => (
            <Text key={row.id} className="font-reading text-base leading-6 text-text-muted">
              {`• ${row.ru}`}
            </Text>
          ))}
        </View>
        <Text variant="caption" className="text-xs">
          {countersLine(counters, item.topic, 'ru')}
        </Text>
      </View>

      <TextInput
        value={text}
        onChangeText={onEdit}
        multiline
        textAlignVertical="top"
        autoCapitalize="sentences"
        autoCorrect={false}
        spellCheck={false}
        placeholder="Напишите письмо…"
        placeholderTextColor={tokens.textMuted}
        testID="skill-writing-input"
        accessibilityLabel="Письмо"
        className="min-h-[220px] rounded-2xl border border-border bg-surface px-4 py-4 text-text"
        style={{ fontFamily: 'Literata_400Regular', fontSize: 18, lineHeight: 29 }}
      />

      {mode === 'unit' && submitted ? (
        <View
          className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4"
          testID="skill-writing-result"
        >
          <Text className="font-ui-bold text-base" testID="skill-writing-verdict">
            {(stored?.correct ?? (grade ? writingCorrect(grade.pct) : false))
              ? 'Письмо засчитано'
              : 'Пока не засчитано'}
          </Text>
          <Text variant="caption">
            {`Оценка на месте: ${Math.round(grade?.pct ?? 0)} %. Засчитывается от ${WRITING_CORRECT_PCT} %.`}
          </Text>
        </View>
      ) : null}

      {!submitted ? (
        <Pressable
          onPress={submit}
          disabled={empty}
          accessibilityRole="button"
          testID="skill-writing-submit"
          className={`items-center rounded-xl py-3.5 ${empty ? 'bg-surface-2' : 'bg-accent'}`}
        >
          <Text className={`font-ui-medium ${empty ? 'text-text-muted' : 'text-bg'}`}>
            Сдать письмо
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
