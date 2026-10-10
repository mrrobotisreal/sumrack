import type { ExamSubtest } from '@sumrak/schema';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

import type { ExamRunState } from './engine/exam-machine';
import type { TorflLevel } from './level-profile';
import { dictionaryAllowed } from './engine/rules';
import type { ExamAnswer } from './model';
import type { TorflPrefs } from './settings-core';
import { sentenceSplit } from './grading/writing';
import { WritingEditor } from './writing/writing-editor';
import { writingItemsOf } from './writing/writing-model';

/**
 * The Письмо mock runner (T72, TORFL §8.3; T76 two tasks) — the `running`
 * phase of a writing subtest: the subtest's writing items in the shared
 * editor, timed by the engine (the host passes `remainingMs`), lookup per
 * the dictionary rule, every draft persisted through `ANSWER` (the response
 * row is the autosave), «Сдать» confirms and submits the subtest.
 *
 * One writing item (A1) renders exactly as before. Two or more (A2: the
 * letter + the messenger note) get a «Задание 1 · Задание 2» stepper under
 * the one subtest timer; each task keeps its own live-persisted draft, and
 * «Сдать» confirms with every task's sentence count.
 */
export function ExamWritingScreen({
  subtest,
  run,
  remainingMs,
  prefs,
  level = 'A1',
  onAnswer,
  onSubmit,
  onQuit,
}: {
  /** T75 (THE LEVEL RULE): the exam's level for `exam_lookup_used` / `exam_writing_scored`. */
  level?: TorflLevel;
  subtest: ExamSubtest;
  run: Pick<ExamRunState, 'answers'>;
  remainingMs: number;
  prefs: TorflPrefs;
  onAnswer: (itemId: string, answer: ExamAnswer) => void;
  onSubmit: () => void;
  onQuit: () => void;
}) {
  const items = writingItemsOf(subtest);
  const [active, setActive] = React.useState(0);
  const item = items[Math.min(active, items.length - 1)];
  if (!item) return null;
  const multi = items.length > 1;
  const textOf = (id: string) => {
    const a = run.answers[id];
    return a?.kind === 'writing' ? a.text : '';
  };
  const given = run.answers[item.id];
  const initial = given?.kind === 'writing' ? given.text : '';
  const lookup = dictionaryAllowed(subtest, prefs);
  const idx = items.indexOf(item);

  const stepper = multi ? (
    <View className="flex-row gap-2 px-4 pb-2" testID="writing-stepper">
      {items.map((it, i) => {
        const n = sentenceSplit(textOf(it.id)).sentences.length;
        const on = i === idx;
        return (
          <Pressable
            key={it.id}
            onPress={() => setActive(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Задание ${i + 1}`}
            testID={`writing-tab-${i + 1}`}
            className={cn(
              'flex-1 items-center rounded-full border px-3 py-2',
              on ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
            )}
          >
            <Text className={cn('font-ui-medium text-sm', on ? 'text-accent' : 'text-text')}>
              Задание {i + 1}
            </Text>
            <Text variant="caption" className="text-xs" testID={`writing-tab-${i + 1}-count`}>
              {n > 0 ? `${n} предл.` : 'пусто'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  return (
    <WritingEditor
      key={item.id}
      item={item}
      initialText={initial}
      mode="mock"
      remainingMs={remainingMs}
      lookup={lookup}
      subtestKind="writing"
      level={level}
      header={stepper}
      heading={multi ? `Письмо · задание ${idx + 1}` : undefined}
      onDraft={(text) => onAnswer(item.id, { kind: 'writing', text })}
      onSubmit={(text) => {
        onAnswer(item.id, { kind: 'writing', text });
        const texts = items.map((it) => (it.id === item.id ? text : textOf(it.id)));
        const allEmpty = texts.every((t) => t.trim().length === 0);
        const counts = texts.map((t) => sentenceSplit(t).sentences.length);
        const detail = multi
          ? `\n${items.map((_, i) => `Задание ${i + 1}: ${counts[i]} предл.`).join(' · ')}.`
          : '';
        Alert.alert(
          multi ? 'Сдать письменную работу?' : 'Сдать письмо?',
          allEmpty
            ? multi
              ? 'Оба задания пусты — субтест будет оценён в 0 %.'
              : 'Письмо пустое — субтест будет оценён в 0 %.'
            : `После сдачи текст изменить нельзя. Оценка появится сразу (предварительно), ИИ оценит позже.${detail}`,
          [
            { text: 'Вернуться', style: 'cancel' },
            { text: 'Сдать', style: 'destructive', onPress: onSubmit },
          ],
        );
      }}
      onQuit={onQuit}
    />
  );
}
