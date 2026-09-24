import { repos } from '@/db';
import type { BankItemRow } from '@/db/repositories/bank';
import type { GrammarLessonRow, WordProfileRecord } from '@/db/repositories/word-forms';
import { AiError } from '@/features/ai/errors';
import {
  buildGrammarLessonMessages,
  type LessonEncounter,
} from '@/features/ai/prompts/grammar-lesson';
import {
  getGrammarStats,
  getModelTable,
  LESSON_MAX_TOKENS,
  recordRunReceipt,
  resolveRun,
  setGrammarStats,
  timeoutFor,
  type AiRunProfile,
  type ResolvedRun,
} from '@/features/ai/run-profile';
import { runChat, type RunChatResult } from '@/features/ai/runner';
import { track } from '@/services/analytics';

import { sectionTitle } from './format';
import { learnerLevelFrom, parseLessonAnswer } from './lesson-core';
import { profileKeyFor } from './profile-core';
import type { ProfileSection } from './profile-schema';

/**
 * Grammar-lesson generation service (M16/T54, WORD_FORMS §6.2 + §7.3).
 * Online-only by nature; every stored lesson is readable offline forever.
 *
 * Flow: resolve the run → build the §6.2 messages from the STORED section
 * of the profile version on screen (+ overview facts, ≤ 3 encounters with
 * their story titles, the learner level) → runChat('grammar-lesson') →
 * `GrammarLessonSchema` (NO automatic retry — the screen offers Retry, the
 * Explain-sheet pattern; a 12k-token lesson at Ultra is not free) →
 * `insertLesson` with the receipt + `profileId` (append-only, decision 10)
 * → `recordRunReceipt(…, 'lesson', …)` → events.
 */

export const MAX_ENCOUNTERS = 3;
/** Recorded in the T54 status row: warmer than the profile's 0.2 (prose, not JSON). */
export const LESSON_TEMPERATURE = 0.4;

/** Injectable transport so the service is testable without the network. */
export type LessonChat = (
  req: Parameters<typeof runChat>[1],
  run: ResolvedRun,
) => Promise<RunChatResult>;

export interface GenerateLessonOptions {
  /** Encounters; `undefined` = look them up (the service trims to MAX_ENCOUNTERS). */
  encounters?: LessonEncounter[];
  /** Learner level; `undefined` = `getLearnerLevel()`. */
  learnerLevel?: string;
}

/** §6.2: the latest stored assessment's `skills.reading.level`, else `A1`. */
export async function getLearnerLevel(): Promise<string> {
  return learnerLevelFrom(await repos.stats.listAssessments());
}

/**
 * Up to MAX_ENCOUNTERS of the learner's own encounters with the story each
 * came from (the profile service's `getProfileContexts`, plus the title the
 * §6.2 user turn wants). Best-effort: unresolvable refs are skipped.
 */
export async function getLessonEncounters(item: BankItemRow): Promise<LessonEncounter[]> {
  const ids: string[] = [];
  if (item.sourceSentenceId) ids.push(item.sourceSentenceId);
  const detail = await repos.bank.getItemWithEncounters(item.id);
  for (const enc of detail?.encounters ?? []) {
    if (enc.sentenceId && !ids.includes(enc.sentenceId)) ids.push(enc.sentenceId);
    if (ids.length >= MAX_ENCOUNTERS * 2) break;
  }
  const out: LessonEncounter[] = [];
  for (const id of ids) {
    const resolved = await repos.content.resolveSentence(id);
    const ru = resolved?.sentence.ru.trim();
    if (ru && !out.some((e) => e.ru === ru)) {
      out.push({ ru, storyTitle: resolved?.story?.titleRu ?? null });
    }
    if (out.length >= MAX_ENCOUNTERS) break;
  }
  return out;
}

/**
 * Generate and store one lesson about `section` of the profile version
 * `profileRow` for the bank item. Throws `AiError` (`invalid-response` when
 * the answer is outside the §6.2 bounds; transport codes pass through from
 * `runChat`). `chat` is injectable for tests only.
 */
export async function generateLesson(
  item: BankItemRow,
  profileRow: WordProfileRecord,
  section: ProfileSection,
  run: AiRunProfile,
  opts: GenerateLessonOptions = {},
  chat: LessonChat = (req, resolved) => runChat('grammar-lesson', req, resolved),
): Promise<GrammarLessonRow> {
  const key = profileKeyFor(item);
  const profile = profileRow.profile;
  if (!key || !profile) {
    throw new AiError('invalid-response', 'This word has no readable profile to teach from.');
  }
  track('lesson_requested', {
    sectionId: section.id,
    provider: run.provider,
    quality: run.quality,
    effort: run.effort,
  });
  const startedAt = Date.now();
  try {
    const resolved = resolveRun(run, await getModelTable());
    const encounters = (opts.encounters ?? (await getLessonEncounters(item))).slice(
      0,
      MAX_ENCOUNTERS,
    );
    const learnerLevel = opts.learnerLevel ?? (await getLearnerLevel());
    const messages = buildGrammarLessonMessages({
      language: profile.language,
      headword: profile.headword.plain,
      pos: profile.pos,
      gloss: profile.overview.gloss,
      section,
      sectionTitleEn: sectionTitle(section).en,
      facts: profile.overview.facts,
      encounters,
      learnerLevel,
    });
    const result = await chat(
      {
        messages,
        maxTokens: LESSON_MAX_TOKENS,
        temperature: LESSON_TEMPERATURE,
        timeoutMs: timeoutFor(run),
      },
      resolved,
    );
    const markdown = parseLessonAnswer(result.content);
    if (markdown === null) {
      throw new AiError(
        'invalid-response',
        result.content.trim().length === 0
          ? 'The model returned an empty lesson — try again, a lower Effort or a higher Quality.'
          : 'The lesson came back outside the expected length — try again.',
      );
    }
    const durationMs = Date.now() - startedAt;
    const usage = result.usage ?? {};
    const row = await repos.wordForms.insertLesson({
      lemmaNorm: key.lemmaNorm,
      kind: key.kind,
      headword: profileRow.headword,
      sectionId: section.id,
      profileId: profileRow.id,
      markdown,
      provider: run.provider,
      model: resolved.model,
      quality: run.quality,
      effort: run.effort,
      effortApplied: result.effortApplied !== false,
      promptTokens: usage.promptTokens ?? null,
      completionTokens: usage.completionTokens ?? null,
      reasoningTokens: usage.reasoningTokens ?? null,
      costUsd: usage.costUsd ?? null,
      durationMs,
    });
    await setGrammarStats(
      recordRunReceipt(await getGrammarStats(), 'lesson', run, {
        ms: durationMs,
        costUsd: usage.costUsd,
        completionTokens: usage.completionTokens,
      }),
    );
    track('lesson_generated', {
      sectionId: section.id,
      ms: durationMs,
      costUsd: usage.costUsd ?? 0,
      chars: markdown.length,
    });
    return row;
  } catch (err) {
    const code = err instanceof AiError ? err.code : 'unknown';
    track('lesson_failed', { sectionId: section.id, code });
    throw err;
  }
}
