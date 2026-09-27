import { hasApiKey } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import { AiError } from '@/features/ai/errors';
import { buildRescueMessages, type RescueInput } from '@/features/ai/prompts/scenario-rescue';
import {
  getGrammarPreset,
  getModelTable,
  resolveRun,
  type AiRunProfile,
  type ModelTable,
} from '@/features/ai/run-profile';
import { runChat, type RunChatResult } from '@/features/ai/runner';
import { extractJsonObject, RescueVerdictSchema } from '@/features/ai/schemas';
import { track } from '@/services/analytics';

import type { JudgeResult } from './judge';

/**
 * The online rescue (T60, SPEAKING_SCENARIOS §5.3, §12): one fast-model
 * call at the M16 run profile's `fastest` notch (of the user's preferred
 * provider) that may flip an offline `miss` to `rescued`. It never blocks
 * progression and never takes more than `RESCUE_TIMEOUT_MS`; any error or
 * timeout ⇒ the offline verdict stands (`scenario_rescue {verdict:'error'}`).
 *
 * The gate + parse are pure (`shouldRescue`, `parseRescueReply`) and
 * fixture-tested; `rescueMiss` is the thin I/O wrapper the executor calls.
 */

export const RESCUE_TIMEOUT_MS = 4000;
export const RESCUE_MAX_TOKENS = 200;
/** ≥ 2 content tokens — a one-word miss is not worth a network round-trip (§5.3). */
export const RESCUE_MIN_CONTENT_TOKENS = 2;

export interface RescueGateInput {
  judge: Pick<JudgeResult, 'verdict' | 'contentTokenCount'>;
  online: boolean;
  rescueOnline: boolean;
  hasKey: boolean;
}

/** §5.3: miss ∧ online ∧ prefs.rescueOnline ∧ key ∧ ≥ 2 content tokens. */
export function shouldRescue(input: RescueGateInput): boolean {
  return (
    input.judge.verdict === 'miss' &&
    input.online &&
    input.rescueOnline &&
    input.hasKey &&
    input.judge.contentTokenCount >= RESCUE_MIN_CONTENT_TOKENS
  );
}

export type RescueOutcome =
  | { verdict: 'accept'; branchKey: string | null; ms: number; model: string; reason?: string }
  | { verdict: 'reject'; ms: number; model: string; reason?: string }
  | { verdict: 'error'; ms: number; model: string | null; code: string };

/**
 * Parse the model's reply: tolerant JSON extraction, then Zod, then the
 * branch key is checked against the turn's allowed keys (an unknown key
 * becomes null ⇒ `next.default`). Throws `invalid-response` on garbage.
 */
export function parseRescueReply(
  content: string,
  allowedKeys: readonly string[],
): {
  verdict: 'accept' | 'reject';
  branchKey: string | null;
  reason?: string;
} {
  const raw = extractJsonObject(content);
  const parsed = RescueVerdictSchema.safeParse(raw);
  if (!parsed.success) throw new AiError('invalid-response', 'rescue reply was not a verdict');
  const key = parsed.data.branchKey ?? null;
  return {
    verdict: parsed.data.verdict,
    branchKey: key !== null && allowedKeys.includes(key) ? key : null,
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
  };
}

/** The `fastest` notch of the user's preferred provider, effort low (§5.3). */
export function rescueProfile(preset: AiRunProfile): AiRunProfile {
  return { provider: preset.provider, quality: 'fastest', effort: 'low' };
}

export interface RescueDeps {
  chat: (input: RescueInput, table: ModelTable, preset: AiRunProfile) => Promise<RunChatResult>;
  now: () => number;
}

const defaultDeps: RescueDeps = {
  chat: (input, table, preset) =>
    runChat(
      'scenario-rescue',
      {
        messages: buildRescueMessages(input),
        maxTokens: RESCUE_MAX_TOKENS,
        temperature: 0,
        timeoutMs: RESCUE_TIMEOUT_MS,
      },
      resolveRun(rescueProfile(preset), table),
    ),
  now: () => Date.now(),
};

/**
 * Run the rescue for one missed attempt. Resolves — never rejects — with
 * the outcome; the executor flips the attempt to `rescued` on `accept`.
 * The gate (`shouldRescue`) is the caller's: this assumes it passed.
 */
export async function rescueMiss(
  input: RescueInput,
  opts: { preset?: AiRunProfile; table?: ModelTable } = {},
  deps: RescueDeps = defaultDeps,
): Promise<RescueOutcome> {
  const startedAt = deps.now();
  let model: string | null = null;
  try {
    const preset = opts.preset ?? (await getGrammarPreset());
    const table = opts.table ?? (await getModelTable());
    model = resolveRun(rescueProfile(preset), table).model;
    const result = await withDeadline(deps.chat(input, table, preset), RESCUE_TIMEOUT_MS);
    const ms = deps.now() - startedAt;
    const verdict = parseRescueReply(result.content, input.allowedKeys);
    track('scenario_rescue', { verdict: verdict.verdict, ms, model: result.model });
    return verdict.verdict === 'accept'
      ? {
          verdict: 'accept',
          branchKey: verdict.branchKey,
          ms,
          model: result.model,
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        }
      : {
          verdict: 'reject',
          ms,
          model: result.model,
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        };
  } catch (err) {
    const ms = deps.now() - startedAt;
    const code = err instanceof AiError ? err.code : 'unknown';
    track('scenario_rescue', { verdict: 'error', ms, model: model ?? 'none', code });
    return { verdict: 'error', ms, model, code };
  }
}

/** A second deadline on top of the client's own: the design's 4 s is a hard promise to the turn. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiError('timeout', 'rescue deadline')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Everything the executor needs to decide + run a rescue in one go. */
export async function maybeRescue(
  judge: JudgeResult,
  input: RescueInput,
  prefs: { rescueOnline: boolean },
): Promise<RescueOutcome | null> {
  const [online, hasKey] = await Promise.all([isOnline(), hasApiKey()]);
  if (!shouldRescue({ judge, online, rescueOnline: prefs.rescueOnline, hasKey })) return null;
  return rescueMiss(input);
}
