import { describe, expect, it } from 'vitest';

import type {
  ScenarioAttemptRow,
  ScenarioRunDebrief,
  ScenarioRunRow,
  ScenarioTurnRuntime,
} from '@/db/repositories/scenarios';

import {
  attemptBadges,
  formatDuration,
  formatSize,
  levelStrip,
  practiceItems,
  transcriptText,
  type DebriefAttempt,
} from '../debrief-core';

/** T63 §10.2 pure helpers: badges, «Practice these», the level strip, the transcript. */

const step = (over: Partial<ScenarioRunDebrief['turns'][number]['step']> = {}) => ({
  turnId: 't2',
  misses: 0,
  assisted: false,
  skipped: false,
  rescued: false,
  meta: 0,
  ...over,
});

function attempt(over: Partial<DebriefAttempt> = {}): DebriefAttempt {
  const base: ScenarioAttemptRow = {
    id: 'a1',
    runId: 'r1',
    turnId: 't2',
    attemptNo: 1,
    kind: 'answer',
    outcome: 'matched',
    transcript: 'у меня болит живот',
    detailJson: '{}',
    audioFile: 't01-a1.ogg',
    audioDurationMs: 2400,
    createdAt: 1,
  };
  return {
    ...base,
    detail: {
      kind: 'answer',
      target: 'У меня болит живот.',
      words: [
        { display: 'У', target: 'у', heard: 'у', matched: true },
        { display: 'меня', target: 'меня', heard: 'меня', matched: true },
        { display: 'болит', target: 'болит', heard: 'болит', matched: true },
        { display: 'живот', target: 'живот', heard: 'живот', matched: true },
      ],
      score: 100,
      slots: { part: 'stomach' },
    },
    ...over,
  };
}

describe('attemptBadges', () => {
  it('matched / rescued / skipped map straight to their badges', () => {
    expect(attemptBadges(attempt(), step())).toEqual(['matched']);
    expect(attemptBadges(attempt({ outcome: 'rescued' }), step())).toEqual(['rescued']);
    expect(attemptBadges(attempt({ outcome: 'skipped' }), step())).toEqual(['skipped']);
  });

  it("a miss is 'near miss' by the judge's rule (score ≥ 40 or any required slot hit), else 'miss'", () => {
    const miss = (score: number, slots: Record<string, string | null>) =>
      attempt({
        outcome: 'miss',
        detail: { kind: 'answer', target: 'x', words: [], score, slots },
      });
    expect(attemptBadges(miss(55, { part: null }), step())).toEqual(['near miss']);
    expect(attemptBadges(miss(10, { part: 'stomach' }), step())).toEqual(['near miss']);
    expect(attemptBadges(miss(10, { part: null }), step())).toEqual(['miss']);
  });

  it('assisted rides along only on the matched attempt of a lifeline turn; meta attempts get none', () => {
    expect(attemptBadges(attempt(), step({ assisted: true }))).toEqual(['matched', 'assisted']);
    expect(attemptBadges(attempt({ outcome: 'miss' }), step({ assisted: true }))).toEqual([
      'near miss',
    ]);
    expect(attemptBadges(attempt({ kind: 'meta', outcome: 'explain' }), step())).toEqual([]);
  });
});

const turns: ScenarioTurnRuntime[] = [
  {
    id: 't2',
    orderIdx: 1,
    speakerId: 'host',
    say: ['s2'],
    expect: {
      slots: [
        {
          kind: 'forms',
          id: 'part',
          required: true,
          acceptsNumber: false,
          options: [
            { key: 'stomach', lemma: 'живот', forms: ['живот', 'живот*'] },
            { key: 'head', lemma: 'голова', forms: ['голов*'] },
          ],
        },
        { kind: 'free', id: 'rest', required: false, minTokens: 1 },
      ],
      accept: ['У меня болит живот.'],
    },
    retry: null,
    next: 't3',
    endingId: null,
  },
  {
    id: 't3',
    orderIdx: 2,
    speakerId: 'host',
    say: ['s3'],
    expect: {
      slots: [
        {
          kind: 'forms',
          id: 'days',
          required: true,
          acceptsNumber: true,
          options: [{ key: 'two', lemma: 'два', forms: ['два', 'две'] }],
        },
      ],
      accept: ['Два дня.'],
    },
    retry: null,
    next: null,
    endingId: 'e1',
  },
];

const run: ScenarioRunRow = {
  id: 'r1',
  packId: 'p',
  scenarioId: 'doc-a1',
  familyId: 'doctor',
  level: 'A1',
  startedAt: 1,
  finishedAt: 2,
  endingId: 'e1',
  pathJson: '{}',
  statsJson: null,
  pinned: false,
  mediaLocal: true,
  mediaBundleState: null,
  mediaBundleName: null,
  gameSessionId: null,
};

describe('practiceItems', () => {
  it('collects the lemmas of required forms slots left unsatisfied on missed attempts, deduped', () => {
    const debrief: ScenarioRunDebrief = {
      run,
      path: null,
      stats: null,
      turns: [
        {
          turnId: 't2',
          step: step({ misses: 2 }),
          attempts: [
            attempt({
              id: 'a1',
              outcome: 'miss',
              detail: { kind: 'answer', target: 'x', words: [], score: 20, slots: { part: null } },
            }),
            attempt({
              id: 'a2',
              attemptNo: 2,
              outcome: 'miss',
              detail: { kind: 'answer', target: 'x', words: [], score: 25, slots: { part: null } },
            }),
            attempt({ id: 'a3', attemptNo: 3, outcome: 'matched' }),
          ],
        },
        {
          turnId: 't3',
          step: step({ turnId: 't3' }),
          attempts: [attempt({ id: 'a4', turnId: 't3' })],
        },
      ],
    };
    const items = practiceItems(debrief, turns, [
      {
        id: 'g1',
        ru: 'живот',
        ruNorm: 'живот',
        en: 'stomach',
        forms: [],
        translit: [],
        explainSentenceId: 'x',
        howToSaySentenceId: 'y',
      },
    ]);
    expect(items.map((i) => i.lemma)).toEqual(['живот', 'голова']);
    expect(items[0]).toMatchObject({ surface: 'живот', translation: 'stomach', turnId: 't2' });
    expect(items[1]).toMatchObject({ surface: 'голов', translation: '' }); // glob stem, no gloss
  });

  it('a clean run yields nothing; a skipped turn with no attempts yields its required slots', () => {
    const clean: ScenarioRunDebrief = {
      run,
      path: null,
      stats: null,
      turns: [{ turnId: 't2', step: step(), attempts: [attempt()] }],
    };
    expect(practiceItems(clean, turns)).toEqual([]);
    const skipped: ScenarioRunDebrief = {
      run,
      path: null,
      stats: null,
      turns: [{ turnId: 't3', step: step({ turnId: 't3', skipped: true }), attempts: [] }],
    };
    expect(practiceItems(skipped, turns).map((i) => i.lemma)).toEqual(['два']);
  });

  it('ignores free/number slots and turns the pack no longer has', () => {
    const debrief: ScenarioRunDebrief = {
      run,
      path: null,
      stats: null,
      turns: [
        {
          turnId: 'gone',
          step: step({ turnId: 'gone', skipped: true }),
          attempts: [],
        },
      ],
    };
    expect(practiceItems(debrief, turns)).toEqual([]);
  });
});

describe('levelStrip', () => {
  it('is deterministic per (duration, seed), fills proportionally, floors idle bars', () => {
    const a = levelStrip(3000, 'a1');
    expect(a).toEqual(levelStrip(3000, 'a1'));
    expect(a).not.toEqual(levelStrip(3000, 'a2'));
    expect(a).toHaveLength(24);
    expect(a.filter((v) => v > 0.15)).toHaveLength(12); // 3 s of a 6 s scale
    expect(a.every((v) => v >= 0.15 && v <= 1)).toBe(true);
    expect(levelStrip(null, 'x').every((v) => v === 0.15)).toBe(true);
    expect(levelStrip(60_000, 'x').every((v) => v > 0.15)).toBe(true);
  });
});

describe('transcriptText', () => {
  it('renders header, stats, turns with ✓/✗/→ marks, meta asks and model answers — no ids', () => {
    const text = transcriptText({
      familyTitle: 'У врача',
      level: 'A1',
      endingTitle: 'Выздоравливайте',
      finishedAt: Date.UTC(2026, 8, 27, 10, 0, 0),
      stats: {
        turns: 2,
        cleanTurns: 1,
        misses: 1,
        lifelines: 0,
        skips: 0,
        metaAsks: 1,
        rescues: 0,
        avgScore: 72.4,
      },
      turns: [
        {
          hostLine: 'Что у вас болит?',
          attempts: [
            attempt({
              id: 'm',
              kind: 'meta',
              outcome: 'explain',
              transcript: 'что значит болит',
              detail: { kind: 'meta', query: 'болит', hit: 'g1', source: 'glossary' },
            }),
            attempt({
              id: 'x',
              outcome: 'miss',
              transcript: 'у меня голова',
              detail: { kind: 'answer', target: 'x', words: [], score: 45, slots: {} },
            }),
            attempt({ id: 'y', attemptNo: 2 }),
          ],
          modelAnswer: 'У меня болит живот.',
        },
        {
          hostLine: 'Сколько дней?',
          attempts: [attempt({ id: 'z', outcome: 'skipped', transcript: '' })],
          modelAnswer: 'Два дня.',
        },
      ],
    });
    expect(text).toContain('Сумрак · Сценарий — У врача (A1)');
    expect(text).toContain('Концовка: Выздоравливайте');
    expect(text).toContain(
      'Ходов 2 · чистых 1 · промахов 1 · подсказок 0 · пропусков 0 · средний балл 72',
    );
    expect(text).toContain('1. Ведущий: Что у вас болит?');
    expect(text).toContain('❔ что значит «болит»');
    expect(text).toContain('✗ Я: у меня голова (45)');
    expect(text).toContain('✓ Я: у меня болит живот (100)');
    expect(text).toContain('≈ У меня болит живот.');
    expect(text).toContain('→ Я: —');
    expect(text).not.toMatch(/r1|a1|t2|g1/);
  });
});

describe('format helpers', () => {
  it('sizes and durations', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(148 * 1024)).toBe('148 KB');
    expect(formatSize(1.3 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatDuration(2400)).toBe('0:02');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(null)).toBe('0:00');
  });
});
