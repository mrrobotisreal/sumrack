import { parseStoredFeedback } from '@/features/ai/schemas';
import { splitSentences } from '@/features/import/import-core';

import { compareTopics, topicLabel } from '../topics';

/**
 * «Мои ответы» — the personal answer bank (T74, TORFL_EXAM_PREP §9): pure
 * model over journal prompts + Mitch's entries. A prompt belongs to the
 * bank when its tags carry `torfl`; `torfl:<topic>` names the §3.4 topic
 * (unknown slugs render raw — a CT session may coin one first). Tested in
 * Node; no DB / React imports.
 */

export const TORFL_PROMPT_TAG = 'torfl';
const TOPIC_TAG_PREFIX = 'torfl:';

export interface AnswerPrompt {
  packId: string;
  id: string;
  promptRu: string;
  promptEn: string;
  tags: string[] | null;
}

export interface AnswerEntry {
  id: string;
  promptId: string | null;
  ru: string;
  aiFeedback: string | null;
  feedbackStatus: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnswerPromptGroup {
  prompt: AnswerPrompt;
  /** Mitch's entries for this prompt, newest first. */
  entries: AnswerEntry[];
}

export interface AnswerTopicGroup {
  /** The `torfl:<topic>` slug, or `'other'` for a `torfl` prompt without one. */
  topic: string;
  labelRu: string;
  labelEn: string;
  prompts: AnswerPromptGroup[];
  /** Entries across the topic's prompts. */
  entryCount: number;
}

export const OTHER_TOPIC = 'other';

/** The `torfl:<topic>` slug of a prompt, else `'other'`. */
export function promptTopic(tags: readonly string[] | null | undefined): string {
  for (const t of tags ?? []) {
    if (t.startsWith(TOPIC_TAG_PREFIX) && t.length > TOPIC_TAG_PREFIX.length) {
      return t.slice(TOPIC_TAG_PREFIX.length);
    }
  }
  return OTHER_TOPIC;
}

export function isTorflPrompt(p: Pick<AnswerPrompt, 'tags'>): boolean {
  return (p.tags ?? []).includes(TORFL_PROMPT_TAG);
}

function topicLabels(topic: string): { ru: string; en: string } {
  if (topic === OTHER_TOPIC) return { ru: 'Другие темы', en: 'Other topics' };
  const l = topicLabel(topic);
  return { ru: l.ru, en: l.en };
}

/**
 * Group the installed `torfl` prompts by topic, each with Mitch's entries
 * (newest first). Topics in §3.4 order, unknown slugs after, `other` last;
 * prompts inside a topic keep pack order. Topics with no prompt vanish.
 */
export function groupAnswers(
  prompts: readonly AnswerPrompt[],
  entries: readonly AnswerEntry[],
): AnswerTopicGroup[] {
  const byPrompt = new Map<string, AnswerEntry[]>();
  for (const e of entries) {
    if (!e.promptId) continue;
    const list = byPrompt.get(e.promptId) ?? [];
    list.push(e);
    byPrompt.set(e.promptId, list);
  }
  for (const list of byPrompt.values()) list.sort((a, b) => b.createdAt - a.createdAt);

  const byTopic = new Map<string, AnswerPromptGroup[]>();
  for (const p of prompts) {
    if (!isTorflPrompt(p)) continue;
    const topic = promptTopic(p.tags);
    const list = byTopic.get(topic) ?? [];
    list.push({ prompt: p, entries: byPrompt.get(p.id) ?? [] });
    byTopic.set(topic, list);
  }
  const topics = [...byTopic.keys()].sort((a, b) => {
    if (a === OTHER_TOPIC) return 1;
    if (b === OTHER_TOPIC) return -1;
    return compareTopics(a, b);
  });
  return topics.map((topic) => {
    const groups = byTopic.get(topic)!;
    const labels = topicLabels(topic);
    return {
      topic,
      labelRu: labels.ru,
      labelEn: labels.en,
      prompts: groups,
      entryCount: groups.reduce((n, g) => n + g.entries.length, 0),
    };
  });
}

// --- rehearsal -------------------------------------------------------------------

export interface RehearsalText {
  /** The sentences to rehearse, in order. */
  sentences: string[];
  /** True when the AI-corrected text was used (the screen labels it «исправленный текст»). */
  corrected: boolean;
}

/**
 * The text a rehearsal reads from: the stored AI correction when the entry
 * has one (§9 — «AI-corrected when available»), else Mitch's own words.
 * Split into sentences by the T28 rule-based splitter; empty → no sentences.
 */
export function rehearsalText(entry: Pick<AnswerEntry, 'ru' | 'aiFeedback'>): RehearsalText {
  const feedback = parseStoredFeedback(entry.aiFeedback);
  const corrected = feedback?.corrected?.trim();
  if (corrected) return { sentences: splitSentences(corrected), corrected: true };
  return { sentences: splitSentences(entry.ru), corrected: false };
}

export type RehearsalPass = 'with-text' | 'without-text';

export interface SentenceResult {
  index: number;
  score: number;
}

export interface RehearsalSummary {
  /** Average score per pass (0–100, one decimal), null when the pass has no results. */
  withText: number | null;
  withoutText: number | null;
  /** The overall score reported to analytics / game_sessions: the recall pass when it ran, else pass 1. */
  score: number;
  /** Sentence indexes (ascending by their worst score, then index) with a score under `weakBelow`. */
  weakest: number[];
}

export const WEAK_SENTENCE_BELOW = 80;

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

/**
 * Summarize both passes. `weakest` lists sentences whose minimum score
 * across the passes is under 80 (the T12 pass mark), weakest first, so the
 * summary can say which lines need another look.
 */
export function summarizeRehearsal(
  withText: readonly SentenceResult[],
  withoutText: readonly SentenceResult[],
  weakBelow = WEAK_SENTENCE_BELOW,
): RehearsalSummary {
  const a = avg(withText.map((r) => r.score));
  const b = avg(withoutText.map((r) => r.score));
  const worst = new Map<number, number>();
  for (const r of [...withText, ...withoutText]) {
    const prev = worst.get(r.index);
    worst.set(r.index, prev === undefined ? r.score : Math.min(prev, r.score));
  }
  const weakest = [...worst.entries()]
    .filter(([, s]) => s < weakBelow)
    .sort((x, y) => x[1] - y[1] || x[0] - y[0])
    .map(([i]) => i);
  return { withText: a, withoutText: b, score: Math.round(b ?? a ?? 0), weakest };
}

/** The rehearsal deep link (`/torfl/rehearse?entryId&topic`). */
export function rehearseHref(
  entryId: string,
  topic: string,
): {
  pathname: '/torfl/rehearse';
  params: { entryId: string; topic: string };
} {
  return { pathname: '/torfl/rehearse', params: { entryId, topic } };
}
