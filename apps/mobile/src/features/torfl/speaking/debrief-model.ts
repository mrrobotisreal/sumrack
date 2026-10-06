import type { Exam, ExamItem, SpeakingMonologueItem, SpeakingTurnItem } from '@sumrak/schema';

import type { ExamResponse } from '@/db/repositories/exams';
import type { ScenarioFamily } from '@/db/repositories/scenarios';

import {
  SPEAKING_MONOLOGUE_CRITERIA,
  SPEAKING_TURN_CRITERIA,
  speakingTaskOf,
  type OfflineSpeakingDetails,
  type SpeakingTask,
} from '../grading/speaking';
import { findExamItem, type ExamCriterion, type SpeakingAnswer } from '../model';

/**
 * The speaking debrief derivations (T73, TORFL §8.4) — PURE: one entry per
 * speaking item of the subtest (answered or not), with the response, the
 * offline details, the merged criteria (AI rows when scored, else offline
 * rows + the AI-only ones pending), the model answer line, and where
 * «Практиковать» goes.
 */

export interface MergedSpeakingCriterion extends ExamCriterion {
  source: 'ai' | 'offline';
  pending: boolean;
}

export interface SpeakingDebriefEntry {
  item: SpeakingTurnItem | SpeakingMonologueItem;
  task: SpeakingTask;
  /** Position among the subtest's speaking items (1-based). */
  number: number;
  response: ExamResponse | null;
  answer: SpeakingAnswer | null;
  details: OfflineSpeakingDetails | null;
  criteria: MergedSpeakingCriterion[];
  /** Tasks 1–2: `accept[0]`; task 3: null (the model story is a reader link). */
  modelLine: string | null;
  /** 0–100 for this response (AI pct when scored, else the offline pct), null when unanswered. */
  pct: number | null;
  /** The unchosen monologue topic (never answered by design). */
  unchosen: boolean;
}

export function mergedSpeakingCriteria(
  task: SpeakingTask,
  response: Pick<ExamResponse, 'grading' | 'gradingStatus'> | null,
): MergedSpeakingCriterion[] {
  const defs = task === 3 ? SPEAKING_MONOLOGUE_CRITERIA : SPEAKING_TURN_CRITERIA;
  const g = response?.grading;
  const pick = (list: ExamCriterion[] | undefined, source: 'ai' | 'offline') =>
    new Map((list ?? []).map((c) => [c.id, { ...c, source, pending: false }]));
  const ai =
    response?.gradingStatus === 'scored'
      ? pick(g?.ai?.criteria, 'ai')
      : new Map<string, MergedSpeakingCriterion>();
  const offline = pick(g?.offline?.criteria, 'offline');
  return defs.map((def) => {
    const hit = ai.get(def.id) ?? offline.get(def.id);
    if (hit) return hit;
    return { id: def.id, score: 0, max: def.max, source: 'offline', pending: true };
  });
}

function isSpeakingAnswer(a: ExamResponse['answer']): a is SpeakingAnswer {
  return (
    !!a &&
    (a.kind === 'speaking-reply' ||
      a.kind === 'speaking-situation' ||
      a.kind === 'speaking-monologue')
  );
}

export function speakingDebriefEntries(
  exam: Exam,
  subtestId: string,
  responses: readonly ExamResponse[],
): SpeakingDebriefEntry[] {
  const subtest = exam.subtests.find((s) => s.id === subtestId);
  if (!subtest) return [];
  const byItem = new Map(
    responses.filter((r) => r.subtestId === subtestId).map((r) => [r.itemId, r]),
  );
  const out: SpeakingDebriefEntry[] = [];
  let n = 0;
  // A monologue group: only the answered topic is listed; if none, the first stands in.
  const groupsSeen = new Set<string>();
  for (const part of subtest.parts) {
    for (const item of part.items) {
      const task = speakingTaskOf(item);
      if (task === null) continue;
      if (item.kind === 'speaking-monologue' && item.group) {
        const siblings = part.items.filter(
          (i): i is SpeakingMonologueItem =>
            i.kind === 'speaking-monologue' && i.group === item.group,
        );
        const answered = siblings.find((s) => byItem.has(s.id));
        if (groupsSeen.has(item.group)) continue;
        groupsSeen.add(item.group);
        const chosen = answered ?? siblings[0]!;
        out.push(entryFor(chosen, 3, ++n, byItem.get(chosen.id) ?? null, !answered));
        continue;
      }
      out.push(
        entryFor(
          item as SpeakingTurnItem | SpeakingMonologueItem,
          task,
          ++n,
          byItem.get(item.id) ?? null,
          false,
        ),
      );
    }
  }
  return out;
}

function entryFor(
  item: SpeakingTurnItem | SpeakingMonologueItem,
  task: SpeakingTask,
  number: number,
  response: ExamResponse | null,
  unchosen: boolean,
): SpeakingDebriefEntry {
  const answer = response && isSpeakingAnswer(response.answer) ? response.answer : null;
  const details =
    (response?.grading?.offline?.details as OfflineSpeakingDetails | undefined) ?? null;
  const criteria = mergedSpeakingCriteria(task, response);
  const pct =
    response && response.points !== null && response.maxPoints > 0
      ? Math.round((response.points / response.maxPoints) * 1000) / 10
      : null;
  return {
    item,
    task,
    number,
    response,
    answer,
    details,
    criteria,
    modelLine: item.kind === 'speaking-monologue' ? null : (item.expect.accept[0] ?? null),
    pct,
    unchosen,
  };
}

/** The word chips of a transcript: the stamps when stored, else the plain words. */
export function transcriptChips(answer: SpeakingAnswer | null): string[] {
  if (!answer) return [];
  if (answer.words && answer.words.length > 0) return answer.words.map((w) => w.w);
  return answer.transcript.split(/\s+/).filter((w) => w.length > 0);
}

/** The «Экзамен» scenario rung (CT033 `a1-scn-exam-001`) when installed — tasks 1–2 practice. */
export function examScenarioRung(
  families: readonly ScenarioFamily[] | undefined,
): { packId: string; scenarioId: string } | null {
  for (const f of families ?? []) {
    for (const r of f.rungs) {
      if (r.packId.includes('scn-exam') || r.familyId === 'exam') {
        return { packId: r.packId, scenarioId: r.id };
      }
    }
  }
  return null;
}

/** Which item of the subtest a response row belongs to (for the results row link). */
export function speakingItemOf(
  exam: Exam,
  response: Pick<ExamResponse, 'itemId' | 'subtestId'>,
): ExamItem | null {
  return findExamItem(exam, response.itemId, response.subtestId)?.item ?? null;
}
