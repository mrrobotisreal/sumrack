import { CourseItemSchema, ExamSchema } from '@sumrak/schema';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { resolveSkill, isHeldOut } from '@/features/learning-evidence/aliases';
import {
  parsePracticeDetail,
  practiceEvidence,
  localDay,
  PRACTICE_MODE,
  EXPOSURE_MODE,
  ExposureSchema,
  type Exposure,
  type LearningEvidence,
} from '@/features/learning-evidence/model';
import { FORM_TASKS, GrammarAttemptSchema, gradeForm } from '@/features/grammar-connections/model';
import { ExamAnswerSchema, findExamItem } from '@/features/torfl/model';
import {
  courseAttempts,
  courseItems,
  examAttempts,
  examResponses,
  exams,
  gameSessions,
  packs,
} from '../schema';
import type { SumrakDB } from '../types';

const ResponsesSchema = z.record(
  z.string(),
  z.object({ answer: z.unknown(), correct: z.boolean(), half: z.boolean().optional() }),
);
function json(raw: string | null): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Read-only projection: neither regrades originals nor creates any cards. */
export function createLearningEvidenceRepo(db: SumrakDB) {
  return {
    async read(): Promise<{ events: LearningEvidence[]; exposures: Exposure[]; unmapped: number }> {
      const [courseRows, itemRows, examRows, practiceRows, examContent] = await Promise.all([
        db.select().from(courseAttempts).where(isNotNull(courseAttempts.finishedAt)),
        db
          .select({ item: courseItems, version: packs.version })
          .from(courseItems)
          .innerJoin(packs, eq(packs.id, courseItems.packId))
          .where(inArray(courseItems.packId, ['a1-hotel-f01', 'a1-hotel-f03', 'a1-hotel-f07'])),
        db
          .select({
            response: examResponses,
            attempt: examAttempts,
            version: packs.version,
          })
          .from(examResponses)
          .innerJoin(examAttempts, eq(examAttempts.id, examResponses.attemptId))
          .leftJoin(packs, eq(packs.id, examAttempts.packId))
          .where(eq(examAttempts.status, 'finished')),
        db
          .select()
          .from(gameSessions)
          .where(
            and(
              inArray(gameSessions.mode, [PRACTICE_MODE, EXPOSURE_MODE, 'grammar-connection']),
              isNotNull(gameSessions.endedAt),
            ),
          ),
        db.select().from(exams).where(eq(exams.packId, 'a1-torfl-lexgram-001')),
      ]);
      const events: LearningEvidence[] = [];
      const exposures: Exposure[] = [];
      let unmapped = 0;
      const items = new Map(itemRows.map((row) => [`${row.item.packId}:${row.item.itemId}`, row]));
      for (const attempt of courseRows) {
        if (isHeldOut(attempt.packId)) continue;
        const responses = ResponsesSchema.safeParse(json(attempt.responsesJson));
        if (!responses.success || attempt.finishedAt === null) {
          unmapped++;
          continue;
        }
        for (const [itemId, response] of Object.entries(responses.data)) {
          const row = items.get(`${attempt.packId}:${itemId}`);
          const item = row ? CourseItemSchema.safeParse(json(row.item.json)) : null;
          const skill =
            item?.success && row
              ? resolveSkill(attempt.packId, row.version, item.data.topic, itemId)
              : null;
          if (!skill || !row || !item?.success) {
            unmapped++;
            continue;
          }
          // Speaking has no reliable grammar verdict here; checks/trigger matching are not imported.
          const objective =
            item.data.kind === 'choice' ||
            item.data.kind === 'typed' ||
            item.data.kind === 'transform';
          events.push({
            id: `hotel:${attempt.id}:${itemId}`,
            source: 'hotel',
            sourceId: attempt.id,
            itemKey: `hotel:${attempt.packId}:${itemId}`,
            context: `hotel:${attempt.packId}:${itemId}`,
            skill,
            at: attempt.finishedAt,
            result: objective ? (response.correct ? 'correct' : 'incorrect') : 'uncertain',
            assistance: 'unknown',
            grader: objective ? 'objective' : 'unknown',
            historicalVersion: null,
            currentVersion: row.version,
            mapping: 'reviewed-current-item',
          });
        }
      }
      const parsedExams = new Map<string, ReturnType<typeof ExamSchema.safeParse>>();
      for (const { response, attempt, version } of examRows) {
        if (isHeldOut(attempt.packId, attempt.examId)) continue;
        const content = examContent.find(
          (e) => e.packId === attempt.packId && e.examId === attempt.examId,
        );
        if (!content) {
          unmapped++;
          continue;
        }
        const key = `${content.packId}:${content.examId}`;
        let parsed = parsedExams.get(key);
        if (!parsed) {
          parsed = ExamSchema.safeParse(json(content.json));
          parsedExams.set(key, parsed);
        }
        const located = parsed.success
          ? findExamItem(parsed.data, response.itemId, response.subtestId)
          : null;
        const skill = located
          ? resolveSkill(attempt.packId, version, located.item.topic, response.itemId)
          : null;
        if (!skill) {
          unmapped++;
          continue;
        }
        const answer = ExamAnswerSchema.safeParse(json(response.answerJson));
        const objective =
          answer.success &&
          (answer.data.kind === 'choice' || answer.data.kind === 'typed') &&
          response.gradingStatus === 'scored';
        events.push({
          id: `exam:${response.id}`,
          source: 'exam',
          sourceId: response.id,
          itemKey: `exam:${attempt.packId}:${attempt.examId}:${response.itemId}`,
          context: `exam:${attempt.packId}:${response.itemId}`,
          skill,
          at: response.createdAt,
          result:
            objective && response.points !== null
              ? response.points >= response.maxPoints
                ? 'correct'
                : 'incorrect'
              : 'uncertain',
          assistance: 'unknown',
          grader: objective
            ? 'objective'
            : answer.success && answer.data.kind.startsWith('speaking-')
              ? 'asr'
              : 'unknown',
          historicalVersion: null,
          currentVersion: version,
          mapping: 'reviewed-current-item',
        });
      }
      for (const row of practiceRows) {
        if (row.endedAt === null) continue;
        if (row.mode === EXPOSURE_MODE) {
          const detail = ExposureSchema.safeParse(row.detail);
          if (detail.success) exposures.push({ ...detail.data, at: row.endedAt });
        } else if (row.mode === 'grammar-connection') {
          const detail = GrammarAttemptSchema.safeParse(row.detail);
          if (!detail.success) continue;
          const d = detail.data;
          const task = FORM_TASKS.find((t) => t.id === d.taskId);
          if (
            !task ||
            task.contextId !== d.contextId ||
            gradeForm(d.taskId, d.trigger, d.answer) !== d.correct
          )
            continue;
          events.push({
            id: `reading:${row.id}`,
            source: 'reading-practice',
            sourceId: row.id,
            itemKey: `reading:${d.taskId}`,
            context: d.contextId,
            skill: d.skillId,
            at: row.endedAt,
            result: d.correct ? 'correct' : 'incorrect',
            assistance: d.helpCount > 0 ? 'help' : 'none',
            grader: 'authored-key',
            historicalVersion: 1,
            currentVersion: 1,
            mapping: 'authored-practice',
            knownRepeat: d.exposure === 'repeat',
          });
        } else {
          const detail = parsePracticeDetail(row.detail);
          if (detail) events.push(practiceEvidence(row.id, row.endedAt, detail));
        }
      }
      // Stored help/exposure wins over an inconsistent claimed unaided result.
      for (const event of events) {
        if (event.source !== 'practice') continue;
        if (
          exposures.some(
            (e) =>
              e.kind === 'help' &&
              e.skill === event.skill &&
              e.at <= event.at &&
              localDay(e.at) === localDay(event.at),
          )
        )
          event.assistance = 'help';
        if (
          exposures.filter(
            (e) =>
              e.kind === 'prompt' && `practice:${e.promptId}` === event.itemKey && e.at <= event.at,
          ).length > 1
        )
          event.knownRepeat = true;
      }
      return { events, exposures, unmapped };
    },
  };
}
