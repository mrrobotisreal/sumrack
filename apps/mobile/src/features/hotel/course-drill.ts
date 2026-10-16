import type { ChoiceItem, CourseItem, ExamPart, ExamSubtest, TypedItem } from '@sumrak/schema';

import type { DrillEntry } from '@/features/torfl/drill/drill-model';
import { torflLevelOf } from '@/features/torfl/level-profile';
import { examItemKey } from '@/features/torfl/model';

/**
 * Course items in the exam deck's drill runner (T89, HOTEL_PATH decision 9).
 * A course card (`examId === 'course'`) resolves its item from `course_items`
 * and maps it onto the existing drill entry kinds, so the deck session renders
 * it with the same views and the same FSRS grading as an exam item:
 *
 * - `choice` → choice (1:1);
 * - `typed` → typed (1:1);
 * - `trigger` → a choice whose options are the sentence's tokens, the answer
 *   is the forcing token's index (the form-trigger question as a pick);
 * - `transform` → typed (the prompt and the accepted forms).
 *
 * Writing and speaking items are not served in the deck (graded in T92).
 */

/** The subtest a course card belongs to, as the drill runner needs it. */
function courseSubtest(kind: string): ExamSubtest {
  return {
    id: `course-${kind}`,
    kind: kind as ExamSubtest['kind'],
    title: { ru: 'Отель «Сумрак»', en: 'Hotel «Sumrak»' },
    instructions: { ru: '', en: '' },
    durationMin: 1,
    dictionary: false,
    navigation: 'free',
    pointsPerItem: 1,
    maxPoints: 1,
  } as ExamSubtest;
}

/** A synthetic one-item part: the drill item view reads `entry.part` for assets only. */
function coursePart(id: string, item: ChoiceItem | TypedItem): ExamPart {
  return {
    id,
    instructions: { ru: '', en: '' },
    items: [item],
  } as ExamPart;
}

/**
 * Map one course item to a drill item. Returns null for writing and speaking
 * items (not served in the deck). The item keeps its course id and topic so
 * the deck key and the topic stats line up with what was recorded.
 */
export function courseDrillItem(item: CourseItem): ChoiceItem | TypedItem | null {
  switch (item.kind) {
    case 'choice':
      return {
        id: item.id,
        topic: item.topic,
        kind: 'choice',
        stem: item.stem,
        stemEn: item.stemEn,
        options: item.options,
        answer: item.answer,
        explain: item.explain,
      } as ChoiceItem;
    case 'trigger':
      return {
        id: item.id,
        topic: item.topic,
        kind: 'choice',
        stem: item.sentence,
        stemEn: undefined,
        options: item.tokens,
        answer: item.answer,
        explain: item.explain,
      } as ChoiceItem;
    case 'typed':
      return {
        id: item.id,
        topic: item.topic,
        kind: 'typed',
        prompt: item.prompt,
        accept: item.accept,
        half: item.half,
        explain: item.explain,
      } as TypedItem;
    case 'transform':
      return {
        id: item.id,
        topic: item.topic,
        kind: 'typed',
        prompt: item.prompt,
        accept: item.accept,
        half: item.half,
        explain: item.explain,
      } as TypedItem;
    default:
      return null;
  }
}

/**
 * The drill entry for a deck card whose item is a course item. Null when the
 * item is gone (a pack update removed it, §12) or is not servable in the deck.
 * `level` follows the pack id convention (`a1-…` → A1), as the deck does.
 */
export function courseDrillEntry(
  packId: string,
  item: CourseItem,
  subtestKind: string,
): DrillEntry | null {
  const drill = courseDrillItem(item);
  if (!drill) return null;
  const subtest = courseSubtest(subtestKind);
  const part = coursePart(`${item.id}-part`, drill);
  return {
    packId,
    examId: 'course',
    subtest,
    part,
    partIdx: 0,
    itemIdx: 0,
    item: drill,
    itemKey: examItemKey(packId, 'course', item.id),
    level: torflLevelOf(packId.startsWith('a2-') ? 'A2' : 'A1'),
  };
}
