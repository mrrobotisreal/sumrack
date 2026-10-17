import type { CheckCard, CourseItem, CourseUnit } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { courseDrillItem } from '@/features/hotel/course-drill';
import { ChoiceItemView } from '@/features/torfl/items/choice-item-view';
import { TypedItemView } from '@/features/torfl/items/typed-item-view';
import { track } from '@/services/analytics';

import { useCourseItems } from '../hotel-hooks';
import { FeedbackPanel } from '../runner/feedback-panel';
import { TriggerItemView } from '../runner/trigger-item-view';
import { checkAnswered, checkChosen, checkCorrect, type CheckResponse } from './check-model';

/**
 * «Проверь себя» (T90 decision 1): 1–4 ungraded checks in PRACTICE mode. Each
 * answer shows the feedback panel at once; «Далее» enables only when every
 * item is answered; wrong answers are fine and never score or enter a deck.
 * Emits `hotel_check_answered`.
 */
export function CheckCardView({
  packId,
  card,
}: {
  packId: string;
  unit?: CourseUnit;
  card: CheckCard;
}) {
  const items = useCourseItems(packId, card.items);
  const [responses, setResponses] = React.useState<Record<string, CheckResponse>>({});
  const [step, setStep] = React.useState(0);

  const list: CourseItem[] = items.data ?? [];
  if (list.length === 0) {
    return (
      <Text variant="muted" testID="check-empty">
        {items.isLoading ? 'Загрузка…' : 'Проверка появится в следующей версии.'}
      </Text>
    );
  }

  const index = Math.min(step, list.length - 1);
  const item = list[index]!;
  const response = responses[item.id];
  const allDone = checkAnswered(list, responses);

  const answer = (value: number | string) => {
    const correct = checkCorrect(item, value);
    setResponses((prev) => ({ ...prev, [item.id]: { answer: value, correct } }));
    track('hotel_check_answered', { itemId: item.id, correct });
  };

  return (
    <View className="gap-4" testID="check-card">
      <Text className="font-ui-medium text-sm text-text-muted">
        Проверь себя · {index + 1} из {list.length}
      </Text>
      <CheckItem key={item.id} item={item} response={response} onAnswer={answer} />
      {response ? (
        <FeedbackPanel
          verdict={response.correct ? 'full' : 'wrong'}
          chosenText={checkChosen(item, response)}
          correctSentence={correctText(item)}
          explain={item.explain ?? ''}
          onNext={() => setStep((s) => Math.min(s + 1, list.length - 1))}
          nextLabel={index < list.length - 1 ? 'Далее →' : 'Готово'}
        />
      ) : null}
      {!allDone ? (
        <Text variant="caption" testID="check-pending">
          Ответьте на каждый вопрос, чтобы продолжить.
        </Text>
      ) : (
        <Text variant="caption" testID="check-done">
          Проверка пройдена. Можно идти дальше.
        </Text>
      )}
      <Pressable
        onPress={() => setStep((s) => Math.min(s + 1, list.length - 1))}
        disabled={!allDone || index >= list.length - 1}
        accessibilityRole="button"
        testID="check-next"
        className="items-center rounded-xl border border-border py-3 active:bg-surface-2"
        style={{ opacity: allDone ? 1 : 0.4 }}
      >
        <Text className="font-ui-medium">Дальше по проверке</Text>
      </Pressable>
    </View>
  );
}

/** One check item in practice mode. The card owns grading; the view only reports the answer. */
function CheckItem({
  item,
  response,
  onAnswer,
}: {
  item: CourseItem;
  response: CheckResponse | undefined;
  onAnswer: (value: number | string) => void;
}) {
  if (item.kind === 'trigger') {
    return (
      <TriggerItemView
        item={{ id: item.id, sentence: item.sentence, tokens: item.tokens, answer: item.answer }}
        feedback="instant"
        initialIndex={typeof response?.answer === 'number' ? response.answer : null}
        onAnswer={onAnswer}
      />
    );
  }
  const drill = courseDrillItem(item);
  if (!drill) return null;
  if (drill.kind === 'choice') {
    return (
      <ChoiceItemView
        item={drill}
        feedback="instant"
        initialIndex={typeof response?.answer === 'number' ? response.answer : null}
        onAnswer={onAnswer}
      />
    );
  }
  return (
    <TypedItemView
      item={drill}
      feedback="instant"
      result={null}
      onSubmit={(text) => onAnswer(text)}
    />
  );
}

/** The correct sentence for the feedback line: the authored stem filled, or the accepted form. */
function correctText(item: CourseItem): string {
  if (item.kind === 'trigger') return item.sentence;
  if (item.kind === 'choice') return item.stem.replace('…', item.options[item.answer] ?? '');
  if (item.kind === 'typed' || item.kind === 'transform') return item.accept[0] ?? '';
  return '';
}
