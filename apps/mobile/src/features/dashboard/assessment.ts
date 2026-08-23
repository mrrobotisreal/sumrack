import type { Repositories } from '@/db/repositories';
import { track } from '@/services/analytics';

import { AiError, toAiError } from '../ai/errors';
import { buildAssessmentMessages } from '../ai/prompts/assessment';
import { runChat } from '../ai/runner';
import { AssessmentResponseSchema, extractJsonObject, type StoredAssessment } from '../ai/schemas';
import { buildAssessmentBundle } from './assessment-core';

export * from './assessment-core';

/**
 * The wired AI CEFR assessment flow (T18, design §7.6 — online-only):
 * bundle → one OpenRouter call through the T16 service → Zod-validated →
 * stored in `assessments` → trended on the dashboard. Pure logic lives in
 * ./assessment-core.ts.
 */

export type AssessmentTrigger = 'manual' | 'auto';

/**
 * Run one assessment end-to-end. Throws AiError on any failure (offline,
 * no key, invalid response) — callers render the error state; nothing is
 * stored on failure.
 */
export async function runAssessment(
  repos: Repositories,
  trigger: AssessmentTrigger,
): Promise<StoredAssessment> {
  track('assessment_requested', { trigger });
  const bundle = await buildAssessmentBundle(repos);
  try {
    const result = await runChat('assessment', {
      messages: buildAssessmentMessages(bundle),
      maxTokens: 2048,
    });
    const parsed = AssessmentResponseSchema.safeParse(extractJsonObject(result.content));
    if (!parsed.success) {
      throw new AiError('invalid-response', 'assessment response did not match the expected shape');
    }
    const stored: StoredAssessment = {
      ...parsed.data,
      v: 1,
      model: result.model,
      createdAt: Date.now(),
      stats: bundle.stats,
    };
    await repos.stats.recordAssessment(stored);
    track('assessment_completed', { trigger, model: result.model });
    return stored;
  } catch (err) {
    const aiErr = toAiError(err);
    track('assessment_failed', { trigger, code: aiErr.code });
    throw aiErr;
  }
}
