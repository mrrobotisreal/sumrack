import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { getGrammarPreset, type AiRunProfile } from '@/features/ai/run-profile';

import {
  DEFAULT_EXAM_GRADING_PRESET,
  parseExamDate,
  parseTorflPrefs,
  sanitizeExamGradingPreset,
  type TorflPrefs,
} from './settings-core';

/**
 * The «ТРКИ» settings accessors (T68, TORFL §4.4) — the one read/write path
 * over `torfl.prefs` / `torfl.examDate` / `torfl.gradingPreset`. Every read
 * is healed through `settings-core`; T69 (hub, countdown), T70 (drill
 * timer), T71 (break screen, lookup rule) and T72 (grading) consume these.
 */

export async function getTorflPrefs(): Promise<TorflPrefs> {
  return parseTorflPrefs(await repos.settings.get<unknown>(SETTING_KEYS.torflPrefs));
}

export async function setTorflPrefs(patch: Partial<Omit<TorflPrefs, 'v'>>): Promise<TorflPrefs> {
  const next = parseTorflPrefs({ ...(await getTorflPrefs()), ...patch });
  await repos.settings.set(SETTING_KEYS.torflPrefs, next);
  return next;
}

export async function getExamDate(): Promise<string | null> {
  return parseExamDate(await repos.settings.get<unknown>(SETTING_KEYS.torflExamDate));
}

/** Set (valid 'YYYY-MM-DD') or clear (null) the exam date; an invalid date throws. */
export async function setExamDate(date: string | null): Promise<void> {
  if (date === null) {
    await repos.settings.remove(SETTING_KEYS.torflExamDate);
    return;
  }
  const clean = parseExamDate(date);
  if (clean === null) throw new Error(`invalid exam date "${date}"`);
  await repos.settings.set(SETTING_KEYS.torflExamDate, clean);
}

/** The default triple: provider follows the grammar preset; quality normal; effort high. */
async function gradingFallback(): Promise<AiRunProfile> {
  const grammar = await getGrammarPreset();
  return { ...DEFAULT_EXAM_GRADING_PRESET, provider: grammar.provider };
}

export async function getExamGradingPreset(): Promise<AiRunProfile> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.torflGradingPreset);
  const fallback = await gradingFallback();
  return stored == null ? fallback : sanitizeExamGradingPreset(stored, fallback);
}

export async function setExamGradingPreset(profile: AiRunProfile): Promise<void> {
  const clean = sanitizeExamGradingPreset(profile, await gradingFallback());
  await repos.settings.set(SETTING_KEYS.torflGradingPreset, { v: 1, ...clean });
}
