import type { Grade } from 'ts-fsrs';

import type { Repositories } from '@/db/repositories';
import { initialAttemptState, type ExamResults } from '../model';
import { ratingForDrillAnswer } from '../pace';
import type { ItemScore } from '../scoring';
import { subtestPercent } from '../scoring';
import type { DrillEntry } from './drill-model';

/**
 * Persists a drill session's answers (T70): ONE drill attempt per exam the
 * session touches (a deck / lightning session spans exams), every answer →
 * one `exam_responses` row + the item's `exam_item_cards` row graded by the
 * pace rule. Drill attempts are exempt from the single-active-attempt rule
 * (repos.exams.startAttempt, scope 'drill'), so this never blocks or
 * resumes a mock. `finish()` closes the attempts with per-subtest results;
 * `abandon()` marks them abandoned (responses + cards stay — every graded
 * answer already persisted).
 */

type ExamsRepo = Pick<
  Repositories['exams'],
  | 'startAttempt'
  | 'recordResponse'
  | 'ensureCard'
  | 'gradeCard'
  | 'finishAttempt'
  | 'abandonAttempt'
>;

export interface RecordedAnswer {
  rating: Grade;
  correct: boolean;
}

interface AttemptBook {
  attemptId: string;
  /** subtestId → { points, maxPoints } over the answers recorded so far. */
  totals: Map<string, { points: number; maxPoints: number; kind: string }>;
}

export function createDrillRecorder(exams: ExamsRepo, now: () => number = Date.now) {
  const books = new Map<string, AttemptBook>();
  const closed = new Set<string>();

  async function bookFor(entry: DrillEntry): Promise<AttemptBook> {
    const key = `${entry.packId}/${entry.examId}`;
    const existing = books.get(key);
    if (existing) return existing;
    const attempt = await exams.startAttempt({
      packId: entry.packId,
      examId: entry.examId,
      scope: 'drill',
      subtestIds: [entry.subtest.id],
      mode: 'drill',
      state: initialAttemptState([{ id: entry.subtest.id, kind: entry.subtest.kind }]),
      now: now(),
    });
    const book: AttemptBook = { attemptId: attempt.id, totals: new Map() };
    books.set(key, book);
    return book;
  }

  return {
    /**
     * Record one answer: response upsert, card ensure + grade. `answer` is
     * the raw payload (`{index}` / `{text}`); `ms` = time on the item.
     */
    async answer(
      entry: DrillEntry,
      answer: { index: number | null } | { text: string },
      score: ItemScore,
      ms: number,
    ): Promise<RecordedAnswer> {
      const book = await bookFor(entry);
      const at = now();
      await exams.recordResponse({
        attemptId: book.attemptId,
        subtestId: entry.subtest.id,
        itemId: entry.item.id,
        answer:
          'index' in answer
            ? { kind: 'choice', index: answer.index }
            : { kind: 'typed', text: answer.text },
        points: score.points,
        maxPoints: score.maxPoints,
        gradingStatus: 'scored',
        durationMs: Math.max(0, Math.round(ms)),
        now: at,
      });
      const t = book.totals.get(entry.subtest.id) ?? {
        points: 0,
        maxPoints: 0,
        kind: entry.subtest.kind,
      };
      t.points += score.points;
      t.maxPoints += score.maxPoints;
      book.totals.set(entry.subtest.id, t);

      await exams.ensureCard({
        packId: entry.packId,
        examId: entry.examId,
        itemId: entry.item.id,
        subtestKind: entry.subtest.kind,
        topic: entry.item.topic,
        now: at,
      });
      const rating = ratingForDrillAnswer(score.outcome, ms, entry.subtest.kind, entry.level);
      await exams.gradeCard(entry.itemKey, rating, at);
      return { rating, correct: score.outcome === 'full' };
    },

    /** Close every attempt as finished. Idempotent. Results = % of the ANSWERED items' max (a drill has no fixed total). */
    async finish(): Promise<void> {
      for (const [key, book] of books) {
        if (closed.has(key)) continue;
        closed.add(key);
        const results: ExamResults = {};
        for (const [subtestId, t] of book.totals) {
          if (t.maxPoints <= 0) continue;
          results[subtestId] = {
            points: t.points,
            maxPoints: t.maxPoints,
            pct: subtestPercent([{ points: t.points }], { maxPoints: t.maxPoints }),
            provisional: false,
            gradedBy: 'offline',
          };
        }
        await exams.finishAttempt(book.attemptId, results, null, 0, now());
      }
    },

    /** Mark every still-open attempt abandoned (quit mid-session). Idempotent. */
    async abandon(): Promise<void> {
      for (const [key, book] of books) {
        if (closed.has(key)) continue;
        closed.add(key);
        await exams.abandonAttempt(book.attemptId, now());
      }
    },

    /** Attempts started so far (tests / diagnostics). */
    attemptCount: () => books.size,
  };
}

export type DrillRecorder = ReturnType<typeof createDrillRecorder>;
