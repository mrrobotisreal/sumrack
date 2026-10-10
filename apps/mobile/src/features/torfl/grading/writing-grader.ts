import type { WritingItem } from '@sumrak/schema';

import { buildExamWritingMessages } from '@/features/ai/prompts/exam-writing';

import { torflLevelOf } from '../level-profile';
import { findExamItem, type ExamGrading } from '../model';
import type { GradedWrite, GraderContext, KindGrader } from './queue-core';
import { criteriaPercent } from './writing';

/** Reasoning + the JSON answer share this budget (a graded letter is ~1.5–3.5k completion tokens). */
export const EXAM_WRITING_MAX_TOKENS = 8_192;

/**
 * The `writing` grader of the kind-agnostic queue (T72). `buildRequest`
 * renders the TORFL §6.2 prompt from the item as printed + the stored
 * letter (+ the model letter's text when the pack has one); `fold` turns a
 * parsed `ExamGrade` into the response row: `points` = pct × maxPoints,
 * `grading.ai` = criteria / corrected / changes / tips + the receipt, the
 * existing `offline` block kept beside it.
 */
export const writingGrader: KindGrader = {
  kind: 'writing',
  async buildRequest(ctx: GraderContext) {
    const { exam, job } = ctx;
    const hit = findExamItem(exam, job.itemId, job.subtestId);
    if (!hit || hit.item.kind !== 'writing') return null;
    if (!job.answer || job.answer.kind !== 'writing' || job.answer.text.trim().length === 0) {
      return null;
    }
    const item: WritingItem = hit.item;
    const modelLetter = item.model
      ? await ctx.storyText(item.model.storyId, item.model.sentenceIds)
      : null;
    return {
      messages: buildExamWritingMessages({
        taskRu: item.task.ru,
        bullets: item.bullets.map((b) => ({ id: b.id, ru: b.text.ru })),
        minSentences: item.minSentences,
        minQuestions: item.minQuestions,
        maxQuestions: item.maxQuestions ?? null,
        letter: job.answer.text,
        modelLetter,
        level: torflLevelOf(exam.level),
        taskTopic: item.topic,
      }),
      maxTokens: EXAM_WRITING_MAX_TOKENS,
    };
  },
  fold(ctx, grade, receipt): GradedWrite {
    const pct = criteriaPercent(grade.criteria);
    const prev: ExamGrading = ctx.job.grading ?? { v: 1 };
    const grading: ExamGrading = {
      v: 1,
      offline: prev.offline,
      ai: {
        criteria: grade.criteria,
        corrected: grade.corrected,
        changes: grade.changes,
        tips: grade.tips,
        provider: receipt.provider,
        model: receipt.model,
        quality: receipt.quality,
        effort: receipt.effort,
        gradedAt: receipt.gradedAt,
        costUsd: receipt.costUsd,
      },
    };
    return {
      points: Math.round((pct / 100) * ctx.job.maxPoints * 10) / 10,
      grading,
      pct,
    };
  },
};
