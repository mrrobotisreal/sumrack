import type { ExamSubtestKind } from '@sumrak/schema';

import { ruPlural } from './hub-model';
import type { TodayStep } from './readiness';
import { SUBTEST_LABELS, topicLabel } from './topics';

/**
 * «Сегодня» / «Тренировка дня» presentation (T70, TORFL §5.3) — pure: turns
 * the recommender's `TodayStep` into copy and a navigation target. The hub
 * section, the Today «ТРКИ» card and the daily segment share it.
 */

export interface TopicTarget {
  packId: string;
  examId: string;
}

export type TodayAction =
  | { kind: 'drill'; source: 'set'; packId: string; examId: string; topic: string }
  | { kind: 'drill'; source: 'deck' }
  | { kind: 'hub' };

const CARDS = ['карточка', 'карточки', 'карточек'] as const;

export function describeStep(step: TodayStep): { title: string; caption: string } {
  switch (step.kind) {
    case 'topic':
      return {
        title: `Подтяни: ${topicLabel(step.topic).ru}`,
        caption: `${SUBTEST_LABELS[step.subtestKind].short} · сейчас ${step.accuracy}% верных — самая слабая тема`,
      };
    case 'deck':
      return {
        title: `Работа над ошибками · ${step.due}`,
        caption: `${step.due} ${ruPlural(step.due, CARDS)} к повторению сегодня`,
      };
    case 'mock':
      return {
        title: 'Пора на пробный экзамен',
        caption: 'Больше недели без варианта, а все разделы выше 60% — проверь себя целиком',
      };
    case 'start':
      return {
        title: 'Начни с тренировки',
        caption: `${SUBTEST_LABELS[step.subtestKind].short}: первые задания помогут оценить уровень`,
      };
  }
}

/**
 * Where a step goes. A topic step starts that topic's drill straight away
 * (the tile's exam); `start` opens the first tile of its subtest; `mock`
 * and unresolvable steps open the hub.
 */
export function stepAction(
  step: TodayStep,
  tilesByTopic: ReadonlyMap<string, TopicTarget>,
  firstTopicOfKind: Partial<Record<ExamSubtestKind, string>>,
): TodayAction {
  if (step.kind === 'deck') return { kind: 'drill', source: 'deck' };
  if (step.kind === 'mock') return { kind: 'hub' };
  const topic = step.kind === 'topic' ? step.topic : firstTopicOfKind[step.subtestKind];
  const target = topic ? tilesByTopic.get(topic) : undefined;
  if (!topic || !target) return { kind: 'hub' };
  return { kind: 'drill', source: 'set', packId: target.packId, examId: target.examId, topic };
}
