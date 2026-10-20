import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  DEFAULT_OPTIONS,
  EXAM_SKILLS,
  parsePlan,
  recentDays,
  weekCoverage,
  weeklyEvidence,
  type Completion,
  type PlannerInput,
} from '../model';
import { localDay, type LearningEvidence } from '@/features/learning-evidence/model';
const now = new Date(2026, 9, 20, 12).getTime();
const base: PlannerInput = {
  now,
  options: DEFAULT_OPTIONS,
  dueCount: 10,
  microphoneAvailable: true,
  readingHref: '/reader/book/story',
  listeningHref: '/listen/book',
  speakingHref: '/scenario/book/story',
  hotelHref: '/hotel/floor/unit',
};
const completed = (skill: Completion['skill'], taskId: string = skill, at = now): Completion => ({
  id: `${at}:${taskId}`,
  v: 1,
  planId: 'plan',
  taskId,
  skill,
  day: localDay(at),
  minutes: 4,
  provenance: 'self-reported',
  at,
});
describe('offline bounded planner', () => {
  it('is deterministic and every 15/30/60-minute plan stays capped with productive work', () => {
    for (const minutes of [15, 30, 60] as const)
      for (const goal of ['exam', 'everyday', 'reading'] as const) {
        const input = { ...base, options: { minutes, goal, quiet: false } };
        const tasks = buildPlan(input);
        expect(tasks).toEqual(buildPlan(input));
        expect(tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(minutes);
        expect(tasks.some((t) => t.skill === 'writing' || t.skill === 'speaking')).toBe(true);
        expect(tasks[0]?.href).toBe('/review/daily');
      }
  });
  it('handles empty/offline/no-date and no microphone without proposing missing content', () => {
    const tasks = buildPlan({
      ...base,
      dueCount: 0,
      readingHref: null,
      listeningHref: null,
      speakingHref: null,
      hotelHref: null,
      microphoneAvailable: false,
      evidence: undefined,
      examDate: null,
    });
    expect(tasks.map((t) => t.href).sort()).toEqual(['/journal/new', '/learning-evidence']);
    expect(tasks.some((t) => t.id === 'review')).toBe(false);
  });
  it('quiet mode substitutes writing and suppresses audio', () => {
    const tasks = buildPlan({ ...base, options: { ...DEFAULT_OPTIONS, quiet: true } });
    expect(tasks.some((t) => t.skill === 'speaking' || t.skill === 'listening')).toBe(false);
    expect(tasks.some((t) => t.skill === 'writing')).toBe(true);
  });
  it('prioritizes uncovered skills over the emphasis using real completion records', () => {
    const history = EXAM_SKILLS.filter((s) => s !== 'reading').map((s) => completed(s));
    const tasks = buildPlan({
      ...base,
      options: { minutes: 15, goal: 'exam', quiet: false },
      completions: history,
    });
    expect(tasks.some((t) => t.skill === 'reading')).toBe(true);
  });
  it('covers all five skills across successive short-day completions when eligible', () => {
    const history: Completion[] = [];
    for (let day = 0; day < 7; day++) {
      const at = new Date(2026, 9, 20 + day, 12).getTime();
      const tasks = buildPlan({
        ...base,
        now: at,
        options: { minutes: 15, goal: 'exam', quiet: false },
        completions: history,
      });
      tasks.forEach((t) => history.push({ ...completed(t.skill, t.id, at), planId: `day-${day}` }));
    }
    expect(EXAM_SKILLS.every((skill) => history.some((h) => h.skill === skill))).toBe(true);
  });
  it('uses local calendar days across month/year/DST boundaries and excludes future evidence', () => {
    const at = new Date(2026, 0, 2, 0, 1).getTime();
    expect([...recentDays(at)]).toEqual([
      '2026-01-02',
      '2026-01-01',
      '2025-12-31',
      '2025-12-30',
      '2025-12-29',
      '2025-12-28',
      '2025-12-27',
    ]);
    expect(recentDays(new Date(2026, 2, 30).getTime()).size).toBe(7);
    const event = completed('writing', 'one', now);
    expect(
      weekCoverage([event, event, { ...event, id: 'future', taskId: 'future', at: now + 1 }], now)
        .writing,
    ).toBe(1);
  });
  it('rejects corrupt persisted plans and never calls repeated practice fresh in the weekly digest', () => {
    const tasks = buildPlan(base);
    expect(parsePlan({ v: 1, day: '2026-10-20', options: DEFAULT_OPTIONS, tasks })).not.toBeNull();
    expect(
      parsePlan({
        v: 1,
        day: '2026-10-20',
        options: { ...DEFAULT_OPTIONS, minutes: 15 },
        tasks: [{ ...tasks[0], minutes: 16 }],
      }),
    ).toBeNull();
    const event: LearningEvidence = {
      id: 'old',
      source: 'practice',
      sourceId: 'id',
      itemKey: 'item',
      context: 'context',
      skill: 'dative-verbs',
      at: new Date(2026, 9, 1).getTime(),
      result: 'incorrect',
      assistance: 'none',
      grader: 'exact-match-v1',
      historicalVersion: 1,
      currentVersion: 1,
      mapping: 'authored-practice',
    };
    expect(
      weeklyEvidence([event, { ...event, id: 'new', at: now, result: 'correct' }], now),
    ).toEqual({ freshUnaided: 0, repeated: 1, missed: 0 });
  });
});
