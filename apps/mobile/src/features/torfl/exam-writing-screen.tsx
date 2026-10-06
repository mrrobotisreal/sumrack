import type { ExamSubtest, WritingItem } from '@sumrak/schema';
import * as React from 'react';
import { Alert } from 'react-native';

import type { ExamRunState } from './engine/exam-machine';
import { dictionaryAllowed } from './engine/rules';
import type { ExamAnswer } from './model';
import type { TorflPrefs } from './settings-core';
import { WritingEditor } from './writing/writing-editor';

/**
 * The Письмо mock runner (T72, TORFL §8.3) — the `running` phase of a
 * writing subtest: the subtest's one writing item in the shared editor,
 * timed by the engine (the host passes `remainingMs`), lookup per the
 * dictionary rule, every draft persisted through `ANSWER` (the response
 * row is the autosave), «Сдать» confirms and submits the subtest.
 */
export function ExamWritingScreen({
  subtest,
  run,
  remainingMs,
  prefs,
  onAnswer,
  onSubmit,
  onQuit,
}: {
  subtest: ExamSubtest;
  run: Pick<ExamRunState, 'answers'>;
  remainingMs: number;
  prefs: TorflPrefs;
  onAnswer: (itemId: string, answer: ExamAnswer) => void;
  onSubmit: () => void;
  onQuit: () => void;
}) {
  const item = subtest.parts.flatMap((p) => p.items).find((i) => i.kind === 'writing') as
    WritingItem | undefined;
  if (!item) return null;
  const given = run.answers[item.id];
  const initial = given?.kind === 'writing' ? given.text : '';
  const lookup = dictionaryAllowed(subtest, prefs);
  return (
    <WritingEditor
      key={item.id}
      item={item}
      initialText={initial}
      mode="mock"
      remainingMs={remainingMs}
      lookup={lookup}
      subtestKind="writing"
      onDraft={(text) => onAnswer(item.id, { kind: 'writing', text })}
      onSubmit={(text) => {
        onAnswer(item.id, { kind: 'writing', text });
        const empty = text.trim().length === 0;
        Alert.alert(
          'Сдать письмо?',
          empty
            ? 'Письмо пустое — субтест будет оценён в 0 %.'
            : 'После сдачи текст изменить нельзя. Оценка появится сразу (предварительно), ИИ оценит позже.',
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
