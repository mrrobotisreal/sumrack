import { z } from 'zod';
import {
  classifiedEvidence,
  localDay,
  type LearningEvidence,
  type SkillSummary,
} from '@/features/learning-evidence/model';
import { SKILLS } from '@/features/learning-evidence/catalog';

export const PLAN_MODE = 'daily-plan-v1';
export const COMPLETE_MODE = 'daily-plan-completion-v1';
export const EXAM_SKILLS = ['lexgram', 'reading', 'listening', 'writing', 'speaking'] as const;
export type ExamSkill = (typeof EXAM_SKILLS)[number];
export const OptionsSchema = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  goal: z.enum(['exam', 'everyday', 'reading']),
  quiet: z.boolean(),
});
export type PlanOptions = z.infer<typeof OptionsSchema>;
export const DEFAULT_OPTIONS: PlanOptions = { minutes: 30, goal: 'everyday', quiet: false };
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  minutes: z.number().int().positive(),
  skill: z.enum(EXAM_SKILLS),
  href: z.string().startsWith('/'),
  reason: z.string(),
});
export type PlanTask = z.infer<typeof TaskSchema>;
export const PlanDetailSchema = z.object({
  v: z.literal(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  options: OptionsSchema,
  tasks: z.array(TaskSchema),
});
export type PlanDetail = z.infer<typeof PlanDetailSchema>;
export const CompletionSchema = z.object({
  v: z.literal(1),
  planId: z.string(),
  taskId: z.string(),
  day: z.string(),
  skill: z.enum(EXAM_SKILLS),
  minutes: z.number().positive(),
  provenance: z.literal('self-reported'),
});
export type CompletionDetail = z.infer<typeof CompletionSchema>;
export interface Completion extends CompletionDetail {
  id: string;
  at: number;
}
export interface PlannerInput {
  now: number;
  options: PlanOptions;
  dueCount: number;
  microphoneAvailable: boolean;
  readingHref: string | null;
  listeningHref: string | null;
  speakingHref: string | null;
  hotelHref?: string | null;
  examDate?: string | null;
  completions?: readonly Completion[];
  evidence?: readonly SkillSummary[];
}
export function recentDays(now: number): Set<string> {
  const days = new Set<string>();
  const d = new Date(now);
  for (let i = 0; i < 7; i++) {
    days.add(localDay(d.getTime()));
    d.setDate(d.getDate() - 1);
  }
  return days;
}
export function weekCoverage(
  history: readonly Completion[],
  now: number,
): Record<ExamSkill, number> {
  const week = recentDays(now);
  const counts = { lexgram: 0, reading: 0, listening: 0, writing: 0, speaking: 0 };
  const seen = new Set<string>();
  for (const event of history) {
    const key = `${event.planId}:${event.taskId}`;
    if (event.at > now || !week.has(event.day) || seen.has(key)) continue;
    seen.add(key);
    counts[event.skill]++;
  }
  return counts;
}
/** Pure, stable and offline. All review ordering/new-card policy stays with /review/daily. */
export function buildPlan(input: PlannerInput): PlanTask[] {
  const { options } = input;
  const coverage = weekCoverage(input.completions ?? [], input.now);
  const weak = [...(input.evidence ?? [])]
    .filter((e) => e.missedItems > 0)
    .sort((a, b) => b.missedItems - a.missedItems || a.skill.localeCompare(b.skill))[0];
  const repair: PlanTask = {
    id: 'repair',
    title: weak ? SKILLS[weak.skill].title : 'Practice a grammar distinction',
    minutes: 5,
    skill: 'lexgram',
    href: weak ? `/learning-evidence/${weak.skill}` : '/learning-evidence',
    reason: weak
      ? `${weak.missedItems} distinct missed ${weak.missedItems === 1 ? 'item' : 'items'} in ${weak.sources.join(' and ')}; historical help may be unknown.`
      : 'Start with a short everyday prompt; no previous evidence is needed.',
  };
  const productive: PlanTask =
    !options.quiet && input.microphoneAvailable && input.speakingHref
      ? {
          id: 'speaking',
          title: 'Speak in a situation',
          minutes: 4,
          skill: 'speaking',
          href: input.speakingHref,
          reason: 'Say something yourself, with the microphone available.',
        }
      : {
          id: 'writing',
          title: 'Write a few Russian sentences',
          minutes: 4,
          skill: 'writing',
          href: '/journal/new',
          reason: options.quiet
            ? 'Quiet mode: write instead of speaking.'
            : 'Writing works offline without microphone permission or a speaking pack.',
        };
  const tasks: PlanTask[] = [productive];
  let remaining = options.minutes - productive.minutes;
  if (input.dueCount > 0) {
    const minutes = Math.min(6, Math.max(2, Math.ceil(input.dueCount / 4)));
    tasks.unshift({
      id: 'review',
      title: 'Review due cards',
      minutes,
      skill: 'lexgram',
      href: '/review/daily',
      reason: 'Use the existing due order and daily new-card allowance. Stop when your time is up.',
    });
    remaining -= minutes;
  }
  const candidates: PlanTask[] = [repair];
  if (input.readingHref)
    candidates.push({
      id: 'reading',
      title: 'Continue reading',
      minutes: 8,
      skill: 'reading',
      href: input.readingHref,
      reason: 'Return to an installed story.',
    });
  if (input.listeningHref && !options.quiet)
    candidates.push({
      id: 'listening',
      title: 'Listen for meaning',
      minutes: 4,
      skill: 'listening',
      href: input.listeningHref,
      reason: 'Use audio already available on this device.',
    });
  if (productive.skill === 'speaking')
    candidates.push({
      id: 'writing',
      title: 'Write a short reflection',
      minutes: 4,
      skill: 'writing',
      href: '/journal/new',
      reason: 'Put one thought into your own Russian words.',
    });
  if (input.hotelHref)
    candidates.push({
      id: 'hotel',
      title: 'Continue your hotel lesson',
      minutes: 8,
      skill: 'lexgram',
      href: input.hotelHref,
      reason: 'Continue the currently unlocked step.',
    });
  const preferred: ExamSkill =
    options.goal === 'reading' ? 'reading' : options.goal === 'exam' ? 'lexgram' : 'listening';
  candidates.sort(
    (a, b) =>
      coverage[a.skill] - coverage[b.skill] ||
      Number(b.skill === preferred) - Number(a.skill === preferred) ||
      a.id.localeCompare(b.id),
  );
  for (const candidate of candidates) {
    const minutes = Math.min(candidate.minutes, remaining);
    if (minutes < Math.min(3, candidate.minutes)) continue;
    tasks.push({
      ...candidate,
      minutes,
      reason:
        `${candidate.reason} ${coverage[candidate.skill] === 0 ? 'No reported completion for this skill in the last 7 days.' : ''}`.trim(),
    });
    remaining -= minutes;
  }
  return tasks;
}
export function parsePlan(raw: unknown): PlanDetail | null {
  const p = PlanDetailSchema.safeParse(raw);
  if (
    !p.success ||
    p.data.tasks.reduce((n, t) => n + t.minutes, 0) > p.data.options.minutes ||
    new Set(p.data.tasks.map((t) => t.id)).size !== p.data.tasks.length
  )
    return null;
  return p.data;
}
export function weeklyEvidence(events: readonly LearningEvidence[], now: number) {
  const week = recentDays(now);
  const rows = classifiedEvidence(events).filter((e) => e.at <= now && week.has(localDay(e.at)));
  return {
    freshUnaided: rows.filter((e) => e.freshUnaided).length,
    repeated: rows.filter((e) => e.result === 'correct' && !e.fresh).length,
    missed: new Set(
      rows.filter((e) => e.result === 'incorrect' && e.grader !== 'asr').map((e) => e.itemKey),
    ).size,
  };
}
