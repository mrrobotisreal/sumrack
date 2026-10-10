import type { SpeakingMonologueItem, SpeakingTurnItem } from '@sumrak/schema';

import {
  buildExamSpeakingMessages,
  type ExamSpeakingInput,
} from '@/features/ai/prompts/exam-speaking';

import { findExamItem, type ExamGrading } from '../model';
import type { GradedWrite, GraderContext, KindGrader } from './queue-core';
import { torflLevelOf } from '../level-profile';
import { speakingCriteriaPercent } from './speaking';

/** Reasoning + the JSON answer share this budget (a monologue grade is ~1–3k completion tokens). */
export const EXAM_SPEAKING_MAX_TOKENS = 6_144;

/**
 * The `speaking` grader of the kind-agnostic queue (T73): registered once
 * at module load (`registerGrader`), nothing else in the queue changes.
 * `buildRequest` renders the TORFL §6.2 prompt for the item's task from
 * the stored transcript(s) (+ the model answer when the pack has one);
 * `fold` turns a parsed `ExamGrade` into the response row: `points` =
 * pct × the response's share (`maxPoints` on the row), `grading.ai` =
 * criteria / corrected / changes / tips + the receipt, the `offline`
 * block kept beside it.
 */
export const speakingGrader: KindGrader = {
  kind: 'speaking',
  async buildRequest(ctx: GraderContext) {
    const { exam, job } = ctx;
    const hit = findExamItem(exam, job.itemId, job.subtestId);
    if (!hit) return null;
    const a = job.answer;
    if (!a || a.kind === 'choice' || a.kind === 'typed' || a.kind === 'writing') return null;
    const hasText = a.transcript.trim().length > 0 || (a.assistTranscript ?? '').trim().length > 0;
    if (!hasText) return null;
    const level = torflLevelOf(exam.level);
    let input: ExamSpeakingInput;
    if (hit.item.kind === 'speaking-reply' || hit.item.kind === 'speaking-situation') {
      const item: SpeakingTurnItem = hit.item;
      const promptRu =
        (await ctx.storyText(item.prompt.storyId, item.prompt.sentenceIds)) ??
        item.situation?.ru ??
        '';
      input = {
        task: item.kind === 'speaking-reply' ? 'reply' : 'situation',
        promptRu,
        situationRu: item.situation?.ru ?? null,
        transcript: a.transcript,
        assistTranscript: a.assistTranscript ?? null,
        modelAnswer: item.expect.accept[0] ?? null,
        level,
      };
    } else if (hit.item.kind === 'speaking-monologue') {
      const item: SpeakingMonologueItem = hit.item;
      const model = item.model
        ? await ctx.storyText(item.model.storyId, item.model.sentenceIds)
        : null;
      input = {
        task: 'monologue',
        promptRu: item.topicTitle.ru,
        questionsRu: item.questions.map((q) => q.ru),
        minSentences: item.minSentences,
        maxSentences: item.maxSentences,
        transcript: a.transcript,
        assistTranscript: a.assistTranscript ?? null,
        modelAnswer: model,
        level,
      };
    } else return null;
    return { messages: buildExamSpeakingMessages(input), maxTokens: EXAM_SPEAKING_MAX_TOKENS };
  },
  fold(ctx, grade, receipt): GradedWrite {
    const pct = speakingCriteriaPercent(grade.criteria);
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
