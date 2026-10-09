import { create } from 'zustand';

import { repos } from '@/db';
import { invalidateExams } from '@/db/hooks';
import { isOnline } from '@/features/ai/connectivity';
import { getModelTable, resolveRun, timeoutFor } from '@/features/ai/run-profile';
import { runChat } from '@/features/ai/runner';
import { recordExamVerdictUnlocks } from '@/features/motivation/service';
import { torflLevelOf } from '@/features/torfl/level-profile';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import type { ExamGrading } from '../model';
import { getExamGradingPreset } from '../settings';
import {
  processGradingQueue,
  recomputeResults,
  type GradingJobInput,
  type KindGrader,
} from './queue-core';
import { speakingGrader } from './speaking-grader';
import type { OfflineWritingDetails } from './writing';
import { writingGrader } from './writing-grader';

/**
 * Production wiring of the exam grading queue (T72, TORFL §6.2). The
 * DURABLE queue is `exam_responses.gradingStatus === 'pending-ai'`; the pump
 * runs on app start / foreground / reconnect (`use-ai-queue.ts`) and on
 * demand («Повторить оценку»). Concurrent triggers join the in-flight pass.
 *
 * **Registry (the T73 contract):** `registerGrader(speakingGrader)` once at
 * module load adds a kind; the queue, the results recompute, the retry
 * policy and the analytics hooks are shared. A response whose kind has no
 * grader stays pending (never fails, never drops).
 */

const graders: KindGrader[] = [writingGrader, speakingGrader];

export function registerGrader(grader: KindGrader): void {
  const idx = graders.findIndex((g) => g.kind === grader.kind);
  if (idx >= 0) graders[idx] = grader;
  else graders.push(grader);
}

export function registeredGraderKinds(): string[] {
  return graders.map((g) => g.kind);
}

interface GradingQueueState {
  /** Response ids in flight (the results row shows «оценивается…»). */
  sending: Record<string, true>;
  /** Bumped on every graded / failed write — screens subscribe to re-read the attempt. */
  gradedVersion: number;
}

export const useGradingQueue = create<GradingQueueState>(() => ({
  sending: {},
  gradedVersion: 0,
}));

function clearSending(responseId: string) {
  useGradingQueue.setState((s) => {
    const { [responseId]: _, ...rest } = s.sending;
    void _;
    return { sending: rest, gradedVersion: s.gradedVersion + 1 };
  });
}

let pumpInFlight: Promise<number> | null = null;

/** The text of a story (or a sentence run) for the model-letter anchor; null when the story is gone. */
export async function storyText(
  packId: string,
  storyId: string,
  sentenceIds?: readonly string[],
): Promise<string | null> {
  const detail = await repos.content.getStoryDetail(packId, storyId);
  if (!detail) return null;
  const wanted = sentenceIds ? new Set(sentenceIds) : null;
  const text = detail.sentences
    .filter((s) => !wanted || wanted.has(s.id))
    .map((s) => s.ru.trim())
    .join(' ');
  return text.length > 0 ? text : null;
}

/**
 * Recompute an attempt's results/verdict from its responses (after an AI or
 * self grade). Fires the verdict-gated achievements the first time a
 * five-subtest verdict appears on the attempt. Safe on any attempt status.
 */
export async function recomputeAttemptResults(attemptId: string): Promise<void> {
  const detail = await repos.exams.getAttempt(attemptId);
  if (!detail) return;
  const exam = await repos.exams.getExam(detail.packId, detail.examId);
  if (!exam) return;
  const { results, verdict } = recomputeResults(
    exam,
    detail.results,
    detail.responses,
    detail.scope,
  );
  await repos.exams.updateResults(attemptId, results, verdict);
  if (verdict !== null && detail.verdict === null) {
    const pcts: Record<string, number> = {};
    for (const s of exam.subtests) {
      const r = results[s.id];
      if (r) pcts[s.kind] = r.pct;
    }
    await recordExamVerdictUnlocks(pcts, verdict, torflLevelOf(exam.level)).catch((err) =>
      logError('manual', err),
    );
  }
  useGradingQueue.setState((s) => ({ gradedVersion: s.gradedVersion + 1 }));
  void invalidateExams();
}

export function pumpGradingQueue(): Promise<number> {
  if (pumpInFlight) return pumpInFlight;
  pumpInFlight = processGradingQueue({
    graders,
    listPending: async () => {
      const rows = await repos.exams.pendingGrading({ limit: 20 });
      useGradingQueue.setState((s) => ({
        sending: { ...s.sending, ...Object.fromEntries(rows.map((r) => [r.id, true as const])) },
      }));
      return rows.map<GradingJobInput>((r) => ({
        responseId: r.id,
        attemptId: r.attemptId,
        packId: r.packId,
        examId: r.examId,
        subtestId: r.subtestId,
        itemId: r.itemId,
        answer: r.answer,
        grading: r.grading,
        points: r.points,
        maxPoints: r.maxPoints,
      }));
    },
    loadExam: (packId, examId) => repos.exams.getExam(packId, examId),
    storyText,
    resolveRun: async () => resolveRun(await getExamGradingPreset(), await getModelTable()),
    chat: (feature, req, run) => runChat(feature, req, run),
    timeoutMs: (run) => timeoutFor(run.profile),
    writeGraded: async (job, write) => {
      await repos.exams.setGrading(job.responseId, {
        points: write.points,
        gradingStatus: 'scored',
        grading: write.grading,
      });
      clearSending(job.responseId);
    },
    writeFailed: async (job, error) => {
      const prev: ExamGrading = job.grading ?? { v: 1 };
      await repos.exams.setGrading(job.responseId, {
        // The provisional (offline) points stay on the row.
        points: job.points,
        gradingStatus: 'ai-failed',
        grading: { ...prev, error: { code: error.code, attempts: error.attempts, at: Date.now() } },
      });
      clearSending(job.responseId);
      void invalidateExams();
    },
    recomputeAttempt: recomputeAttemptResults,
    isOnline,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    onScored: (job, write) => {
      const d = write.grading.offline?.details as
        (Partial<OfflineWritingDetails> & { task?: number }) | undefined;
      if (
        job.answer &&
        job.answer.kind !== 'choice' &&
        job.answer.kind !== 'typed' &&
        job.answer.kind !== 'writing'
      ) {
        track('exam_speaking_scored', { task: d?.task ?? 0, source: 'ai', pct: write.pct });
        return;
      }
      track('exam_writing_scored', {
        source: 'ai',
        pct: write.pct,
        sentences: d?.sentences ?? -1,
        questions: d?.questions ?? -1,
        pointsCovered: d?.pointsCovered ?? -1,
      });
    },
    onFailed: (job, code) => {
      const speaking =
        !!job.answer &&
        job.answer.kind !== 'choice' &&
        job.answer.kind !== 'typed' &&
        job.answer.kind !== 'writing';
      track('exam_grading_failed', { kind: speaking ? 'speaking' : 'writing', code });
    },
  }).finally(() => {
    pumpInFlight = null;
    useGradingQueue.setState({ sending: {} });
  });
  return pumpInFlight;
}

/**
 * User action («Повторить оценку»): put an `ai-failed` / `provisional`
 * response back on the queue (points + offline grading kept, the error
 * cleared) and pump at once.
 */
export async function requestGrading(responseId: string): Promise<boolean> {
  const row = await repos.exams.getResponse(responseId);
  if (!row || !row.answer) return false;
  const prev: ExamGrading = row.grading ?? { v: 1 };
  const { error: _error, ...kept } = prev;
  void _error;
  await repos.exams.setGrading(responseId, {
    points: row.points,
    gradingStatus: 'pending-ai',
    grading: kept,
  });
  useGradingQueue.setState((s) => ({ sending: { ...s.sending, [responseId]: true } }));
  const speaking =
    row.answer.kind !== 'choice' && row.answer.kind !== 'typed' && row.answer.kind !== 'writing';
  track('ai_request_queued', { feature: speaking ? 'exam-speaking' : 'exam-writing' });
  void invalidateExams();
  void pumpGradingQueue();
  return true;
}
