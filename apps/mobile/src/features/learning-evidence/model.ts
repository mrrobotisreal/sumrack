import { z } from 'zod';
import {
  PILOT_SKILLS,
  PRACTICE,
  SkillSchema,
  type PilotSkill,
  type PracticePrompt,
} from './catalog';

export const PRACTICE_MODE = 'learning-evidence-v1';
export const EXPOSURE_MODE = 'learning-evidence-exposure-v1';
export const ExposureSchema = z.object({
  v: z.literal(1),
  skill: SkillSchema,
  kind: z.enum(['prompt', 'help']),
  promptId: z.string().optional(),
});
export type Exposure = z.infer<typeof ExposureSchema> & { at: number };

export interface LearningEvidence {
  id: string;
  source: 'hotel' | 'exam' | 'practice' | 'reading-practice';
  sourceId: string;
  itemKey: string;
  context: string;
  skill: PilotSkill;
  at: number;
  result: 'correct' | 'incorrect' | 'uncertain';
  assistance: 'none' | 'help' | 'unknown';
  grader: 'exact-match-v1' | 'authored-key' | 'objective' | 'unknown' | 'asr';
  historicalVersion: number | null;
  currentVersion: number | null;
  mapping: 'reviewed-current-item' | 'authored-practice';
  knownRepeat?: boolean;
}
export interface SkillSummary {
  skill: PilotSkill;
  practiced: number;
  missedItems: number;
  sources: string[];
  assistedSuccess: number;
  unknownSuccess: number;
  freshUnaided: number;
  repeatedSuccess: number;
}
export function localDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dedupeEvidence(events: readonly LearningEvidence[]): LearningEvidence[] {
  return [...new Map(events.map((e) => [e.id, e])).values()].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  );
}
/** First exposure to an item/context only; reattempts never become transfer. */
export function classifiedEvidence(events: readonly LearningEvidence[]) {
  const seenItems = new Set<string>();
  const seenContexts = new Set<string>();
  return dedupeEvidence(events).map((event) => {
    const contextKey = `${event.skill}:${event.context}`;
    const fresh =
      !event.knownRepeat && !seenItems.has(event.itemKey) && !seenContexts.has(contextKey);
    seenItems.add(event.itemKey);
    seenContexts.add(contextKey);
    const freshUnaided =
      fresh &&
      event.result === 'correct' &&
      event.assistance === 'none' &&
      event.historicalVersion !== null &&
      (event.grader === 'exact-match-v1' || event.grader === 'authored-key');
    return { ...event, fresh, freshUnaided };
  });
}
export function summarizeEvidence(events: readonly LearningEvidence[]): SkillSummary[] {
  const classified = classifiedEvidence(events);
  return PILOT_SKILLS.map((skill) => {
    const rows = classified.filter((e) => e.skill === skill);
    return {
      skill,
      practiced: new Set(rows.map((e) => e.itemKey)).size,
      missedItems: new Set(
        rows.filter((e) => e.result === 'incorrect' && e.grader !== 'asr').map((e) => e.itemKey),
      ).size,
      sources: [...new Set(rows.map((e) => e.source))],
      assistedSuccess: rows.filter((e) => e.result === 'correct' && e.assistance === 'help').length,
      unknownSuccess: rows.filter((e) => e.result === 'correct' && e.assistance === 'unknown')
        .length,
      freshUnaided: rows.filter((e) => e.freshUnaided).length,
      repeatedSuccess: rows.filter((e) => e.result === 'correct' && !e.fresh).length,
    };
  });
}
export const PracticeDetailSchema = z.object({
  v: z.literal(1),
  skill: SkillSchema,
  promptId: z.string(),
  context: z.string(),
  catalogVersion: z.literal(1),
  answer: z.string().max(500),
  correct: z.boolean(),
  assistance: z.enum(['none', 'help']),
  exposure: z.enum(['first', 'repeat']),
  grader: z.literal('exact-match-v1'),
});
export type PracticeDetail = z.infer<typeof PracticeDetailSchema>;
export function parsePracticeDetail(raw: unknown): PracticeDetail | null {
  const parsed = PracticeDetailSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const prompt = PRACTICE.find((p) => p.id === d.promptId);
  if (
    !prompt ||
    prompt.skill !== d.skill ||
    prompt.context !== d.context ||
    gradePractice(prompt, d.answer) !== d.correct
  )
    return null;
  return d;
}
function normalized(answer: string) {
  return answer
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u0301/g, '')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}
export function gradePractice(prompt: PracticePrompt, answer: string): boolean {
  return normalized(answer) === normalized(prompt.answer);
}
export function practiceEvidence(id: string, at: number, detail: PracticeDetail): LearningEvidence {
  return {
    id: `practice:${id}`,
    source: 'practice',
    sourceId: id,
    itemKey: `practice:${detail.promptId}`,
    context: detail.context,
    skill: detail.skill,
    at,
    result: detail.correct ? 'correct' : 'incorrect',
    assistance: detail.assistance,
    grader: detail.grader,
    historicalVersion: 1,
    currentVersion: 1,
    mapping: 'authored-practice',
    knownRepeat: detail.exposure === 'repeat',
  };
}
/** One context per local day. Tomorrow picks a different unused context; repeats are explicit. */
export function nextPractice(
  skill: PilotSkill,
  history: readonly LearningEvidence[],
  now: number,
  exposures: readonly Exposure[] = [],
) {
  const prompts = PRACTICE.filter((p) => p.skill === skill);
  const own = [
    ...dedupeEvidence(history).filter((e) => e.source === 'practice' && e.skill === skill),
    ...exposures
      .filter((e) => e.skill === skill && e.kind === 'prompt')
      .map((e) => ({
        at: e.at,
        itemKey: `practice:${e.promptId}`,
        context: prompts.find((p) => p.id === e.promptId)?.context,
      })),
  ].sort((a, b) => a.at - b.at);
  const latest = own.at(-1);
  if (latest && localDay(latest.at) === localDay(now)) {
    return {
      prompt: prompts.find((p) => `practice:${p.id}` === latest.itemKey) ?? prompts[0]!,
      repeat: true,
      nextDay: true,
    };
  }
  const unseen = prompts.find((p) => !own.some((e) => e.itemKey === `practice:${p.id}`));
  return {
    prompt: unseen ?? prompts.find((p) => p.context !== latest?.context) ?? prompts[0]!,
    repeat: !unseen,
    nextDay: false,
  };
}
