import { track, type AnalyticsProps } from '@/services/analytics';

import { chatCompletion, type ChatRequest, type ChatResult } from './client';
import { getApiKey, getModel } from './config';
import { AiError, toAiError } from './errors';
import { USAGE_EXTRAS, type ResolvedRun } from './run-profile';

/**
 * The production chat entry point + request-lifecycle analytics (CLAUDE.md:
 * exceptional tracking): every AI request emits sent/succeeded/failed with
 * its feature tag, so the queue is debuggable from analytics_events alone.
 * Props carry codes and counts only — never text, never the key.
 *
 * T51: an optional `run` (a resolved run profile) sets the model + request
 * extras and adds provider/quality/effort/model to the lifecycle events.
 * Without it the request is byte-identical to the T16 shape (ADR-0018
 * decision 4 / design decision 6 — the five legacy features are untouched).
 */
export type AiFeature =
  | 'journal-feedback'
  | 'enrichment'
  | 'explain'
  | 'key-test'
  | 'assessment'
  | 'import-annotate'
  | 'word-profile'
  | 'grammar-lesson'
  | 'grammar-key-test';

export interface RunChatResult extends ChatResult {
  /**
   * False when the §4.4 fallback fired: the provider rejected the effort
   * parameter and the request was retried without it (carried into the
   * profile/lesson receipt). Undefined for legacy requests without `run`.
   */
  effortApplied?: boolean;
}

/**
 * Words a provider uses when it rejects the effort lever (WORD_FORMS §4.4).
 * Text-based on purpose — OpenRouter passes provider messages through —
 * and exported so T55's matrix can extend it if a provider phrases it
 * differently.
 */
export const EFFORT_REJECTION_WORDS: readonly string[] = [
  'verbosity',
  'reasoning',
  'effort',
  'unsupported parameter',
];

/** A 4xx `http-client` error whose message names the effort parameter. */
export function isEffortParamRejection(err: unknown): boolean {
  if (!(err instanceof AiError) || err.code !== 'http-client') return false;
  if (err.status !== undefined && (err.status < 400 || err.status >= 500)) return false;
  const message = err.message.toLowerCase();
  return EFFORT_REJECTION_WORDS.some((word) => message.includes(word));
}

function runProps(run: ResolvedRun | undefined): AnalyticsProps {
  if (!run) return {};
  return {
    provider: run.profile.provider,
    quality: run.profile.quality,
    effort: run.profile.effort,
    model: run.model,
  };
}

export async function runChat(
  feature: AiFeature,
  req: ChatRequest,
  run?: ResolvedRun,
): Promise<RunChatResult> {
  const props = runProps(run);
  track('ai_request_sent', { feature, ...props });
  const startedAt = Date.now();
  const deps = { getApiKey, getModel };
  const request: ChatRequest = run ? { ...req, model: run.model, extras: run.extras } : req;
  try {
    let result: ChatResult;
    let effortApplied: boolean | undefined = run ? true : undefined;
    try {
      result = await chatCompletion(request, deps);
    } catch (err) {
      // §4.4: one retry without the effort lever, usage accounting kept.
      if (!run || !isEffortParamRejection(err)) throw err;
      track('ai_effort_param_rejected', { provider: run.profile.provider, model: run.model });
      result = await chatCompletion({ ...request, extras: { ...USAGE_EXTRAS } }, deps);
      effortApplied = false;
    }
    track('ai_request_succeeded', { feature, ms: Date.now() - startedAt, ...props });
    return effortApplied === undefined ? result : { ...result, effortApplied };
  } catch (err) {
    const aiErr = toAiError(err);
    track('ai_request_failed', {
      feature,
      code: aiErr.code,
      ms: Date.now() - startedAt,
      ...props,
    });
    throw aiErr;
  }
}
