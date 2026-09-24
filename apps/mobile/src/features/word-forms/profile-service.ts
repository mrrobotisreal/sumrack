import { repos } from '@/db';
import type { BankItemRow } from '@/db/repositories/bank';
import type { WordProfileRow } from '@/db/repositories/word-forms';
import { AiError } from '@/features/ai/errors';
import {
  buildWordProfileCorrectionMessages,
  buildWordProfileMessages,
} from '@/features/ai/prompts/word-profile';
import {
  getGrammarStats,
  getModelTable,
  PROFILE_MAX_TOKENS,
  recordRunReceipt,
  resolveRun,
  setGrammarStats,
  timeoutFor,
  type AiRunProfile,
  type ResolvedRun,
} from '@/features/ai/run-profile';
import { runChat, type RunChatResult } from '@/features/ai/runner';
import { extractJsonObject } from '@/features/ai/schemas';
import { track } from '@/services/analytics';

import { profileKeyFor, validateProfile } from './profile-core';
import { WordProfileSchema, type ProfileLanguage, type WordProfile } from './profile-schema';

/**
 * Word-profile generation service (M16/T52, WORD_FORMS §5.5). Online-only
 * by nature; everything it stores is read offline forever after (§1.2).
 *
 * Flow: resolve the run → build the §6.1 messages (≤ 3 encounter contexts)
 * → runChat('word-profile') → extractJsonObject → Zod → validateProfile →
 * on failure ONE correction round with the verbatim issues → persist as
 * the new current version with its receipt → fold the receipt into
 * `grammar.stats` through T51's `recordRunReceipt` → events.
 *
 * Nothing estimate-related lives here (design §5.5 last line).
 */

export const MAX_CONTEXTS = 3;
const PROFILE_TEMPERATURE = 0.2;

export interface GenerateProfileOptions {
  /** Encounter sentences; the service trims to MAX_CONTEXTS. `undefined` = look them up. */
  contexts?: string[];
  language?: ProfileLanguage;
  /** Analytics only: a regeneration of an existing key. `undefined` = derived from the DB. */
  regenerate?: boolean;
}

export interface GenerateProfileResult {
  row: WordProfileRow;
  profile: WordProfile;
  /** Rule 6 soft warnings from the validator (dev readout). */
  warnings: string[];
  /** True when the one correction round was needed. */
  corrected: boolean;
}

/** Injectable transport so the correction round is testable without the network. */
export type ProfileChat = (
  req: Parameters<typeof runChat>[1],
  run: ResolvedRun,
) => Promise<RunChatResult>;

/**
 * Up to MAX_CONTEXTS encounter sentences for an item, newest encounter
 * first, the bank item's own source sentence guaranteed in (the
 * `getEnrichmentContext` precedent, generalized to several encounters).
 * Missing/unresolvable refs are skipped — contexts are best-effort.
 */
export async function getProfileContexts(item: BankItemRow): Promise<string[]> {
  const ids: string[] = [];
  if (item.sourceSentenceId) ids.push(item.sourceSentenceId);
  const detail = await repos.bank.getItemWithEncounters(item.id);
  for (const enc of detail?.encounters ?? []) {
    if (enc.sentenceId && !ids.includes(enc.sentenceId)) ids.push(enc.sentenceId);
    if (ids.length >= MAX_CONTEXTS * 2) break; // a few spares for unresolvable refs
  }
  const out: string[] = [];
  for (const id of ids) {
    const resolved = await repos.content.resolveSentence(id);
    const ru = resolved?.sentence.ru.trim();
    if (ru && !out.includes(ru)) out.push(ru);
    if (out.length >= MAX_CONTEXTS) break;
  }
  return out;
}

interface Attempt {
  ok: true;
  profile: WordProfile;
  warnings: string[];
}
interface Failure {
  ok: false;
  issues: string[];
}

/** Pure: raw answer → parsed + validated profile, or the issue list for the correction turn. */
export function parseProfileAnswer(content: string): Attempt | Failure {
  const json = extractJsonObject(content);
  if (json === null) return { ok: false, issues: ['the answer is not a single JSON object'] };
  const parsed = WordProfileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    };
  }
  const result = validateProfile(parsed.data);
  if (!result.ok) return { ok: false, issues: result.issues };
  return { ok: true, profile: parsed.data, warnings: result.warnings };
}

/**
 * Generate, validate, store and version a profile for one bank item.
 * Throws `AiError` (`invalid-response` after the failed correction round;
 * transport codes pass through from `runChat`). `chat` is injectable for
 * tests only — production uses `runChat('word-profile', …)`.
 */
export async function generateProfile(
  item: BankItemRow,
  run: AiRunProfile,
  opts: GenerateProfileOptions = {},
  chat: ProfileChat = (req, resolved) => runChat('word-profile', req, resolved),
): Promise<GenerateProfileResult> {
  const key = profileKeyFor(item);
  if (!key) {
    throw new AiError(
      'invalid-response',
      'This word has no lemma yet — add one (Edit or Enrich) first.',
    );
  }
  const language = opts.language ?? 'ru';
  const headword = item.kind === 'word' ? (item.lemma ?? item.surface) : item.surface;
  const regenerate =
    opts.regenerate ?? (await repos.wordForms.getCurrentProfile(key.lemmaNorm, key.kind)) !== null;
  track('word_profile_requested', {
    kind: key.kind,
    provider: run.provider,
    quality: run.quality,
    effort: run.effort,
    regenerate,
  });
  const startedAt = Date.now();
  try {
    const resolved = resolveRun(run, await getModelTable());
    const contexts = (opts.contexts ?? (await getProfileContexts(item))).slice(0, MAX_CONTEXTS);
    const messages = buildWordProfileMessages({
      language,
      kind: item.kind,
      headword,
      surface: item.surface,
      translation: item.translation,
      grammar: item.grammar,
      pos: item.pos,
      level: item.level,
      contexts,
    });
    const request = {
      maxTokens: PROFILE_MAX_TOKENS,
      temperature: PROFILE_TEMPERATURE,
      timeoutMs: timeoutFor(run),
    };

    let result = await chat({ ...request, messages }, resolved);
    let attempt = parseProfileAnswer(result.content);
    let corrected = false;
    const usage = { ...result.usage };
    let effortApplied = result.effortApplied !== false;
    if (!attempt.ok) {
      // §5.5 step 3: exactly one correction round with the verbatim issues.
      track('word_profile_invalid_retry', { issues: attempt.issues.length });
      const retry = await chat(
        {
          ...request,
          messages: buildWordProfileCorrectionMessages(messages, result.content, attempt.issues),
        },
        resolved,
      );
      corrected = true;
      result = retry;
      attempt = parseProfileAnswer(retry.content);
      addUsage(usage, retry.usage);
      effortApplied = effortApplied && retry.effortApplied !== false;
      if (!attempt.ok) {
        throw new AiError(
          'invalid-response',
          `The model's profile failed validation twice (${attempt.issues.length} issue${attempt.issues.length === 1 ? '' : 's'}).`,
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    const row = await repos.wordForms.insertProfile({
      lemmaNorm: key.lemmaNorm,
      kind: key.kind,
      headword,
      pos: attempt.profile.pos,
      payload: attempt.profile,
      provider: run.provider,
      model: resolved.model,
      quality: run.quality,
      effort: run.effort,
      effortApplied,
      promptTokens: usage.promptTokens ?? null,
      completionTokens: usage.completionTokens ?? null,
      reasoningTokens: usage.reasoningTokens ?? null,
      costUsd: usage.costUsd ?? null,
      durationMs,
    });
    await setGrammarStats(
      recordRunReceipt(await getGrammarStats(), 'profile', run, {
        ms: durationMs,
        costUsd: usage.costUsd,
        completionTokens: usage.completionTokens,
      }),
    );
    track('word_profile_generated', {
      kind: key.kind,
      pos: attempt.profile.pos,
      sections: attempt.profile.sections.length,
      ms: durationMs,
      promptTokens: usage.promptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      costUsd: usage.costUsd ?? 0,
      corrected,
    });
    return { row, profile: attempt.profile, warnings: attempt.warnings, corrected };
  } catch (err) {
    const code = err instanceof AiError ? err.code : 'unknown';
    track('word_profile_failed', { kind: key.kind, code, ms: Date.now() - startedAt });
    throw err;
  }
}

type Usage = NonNullable<RunChatResult['usage']>;

/** Sum a retry's usage into the first call's (the receipt covers the whole generation). */
function addUsage(into: Usage, more: Usage | undefined): void {
  if (!more) return;
  for (const k of ['promptTokens', 'completionTokens', 'reasoningTokens', 'costUsd'] as const) {
    if (more[k] !== undefined) into[k] = (into[k] ?? 0) + more[k];
  }
}
