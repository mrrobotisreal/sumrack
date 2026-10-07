import { describe, expect, it } from 'vitest';

import { planPrune } from '@/features/scenario/recordings/prune-core';

import {
  DEFAULT_EXAM_MEDIA_LEDGER,
  examBundleStem,
  ExamMediaLedgerSchema,
  parseExamMediaLedger,
} from '../media-state-core';

/** T74 — the exam media ledger (`torfl.media`) + exam-root retention through the T63 planner (TORFL §8.5). */

describe('parseExamMediaLedger', () => {
  it('accepts a well-formed ledger whole', () => {
    const ledger = {
      v: 1,
      attempts: { 'abc-1': { state: 'uploaded', name: 'sumrak-media-exam-abc-1.json' } },
    };
    expect(ExamMediaLedgerSchema.parse(ledger)).toEqual(ledger);
    expect(parseExamMediaLedger(ledger)).toEqual(ledger);
  });

  it('heals entry by entry: malformed entries drop, valid ones survive; garbage → the default', () => {
    expect(
      parseExamMediaLedger({
        v: 1,
        attempts: {
          ok: { state: 'pending', name: 'sumrak-media-exam-ok.json' },
          badState: { state: 'done', name: 'x.json' },
          noName: { state: 'uploaded' },
          '': { state: 'uploaded', name: 'x.json' },
        },
      }),
    ).toEqual({ v: 1, attempts: { ok: { state: 'pending', name: 'sumrak-media-exam-ok.json' } } });
    expect(parseExamMediaLedger(null)).toEqual(DEFAULT_EXAM_MEDIA_LEDGER);
    expect(parseExamMediaLedger('nope')).toEqual(DEFAULT_EXAM_MEDIA_LEDGER);
    expect(parseExamMediaLedger({ v: 2, attempts: [] })).toEqual(DEFAULT_EXAM_MEDIA_LEDGER);
  });
});

describe('examBundleStem', () => {
  it('lowercases the attempt id behind an exam- prefix', () => {
    expect(examBundleStem('MKXY1ABC-Q7z')).toBe('exam-mkxy1abc-q7z');
    expect(examBundleStem('mkxy1abc-q7z')).toBe('exam-mkxy1abc-q7z');
  });
});

describe('exam-root retention through planPrune (T73 chain, T74 protection)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 9, 7, 12);
  const attempt = (
    id: string,
    ageDays: number,
    bytes: number,
    extra: Partial<Parameters<typeof planPrune>[0][number]> = {},
  ) => ({
    runId: id,
    startedAt: NOW - ageDays * DAY - 60_000,
    finishedAt: NOW - ageDays * DAY,
    pinned: false,
    bytes,
    bundleState: 'uploaded' as const,
    ...extra,
  });
  const POLICY = { pruneDays: 30, capBytes: 300_000_000 };

  it('an old unpinned attempt is pruned; a pinned one of the same age is kept', () => {
    const plan = planPrune(
      [
        attempt('old', 45, 500),
        attempt('pinned', 45, 500, { pinned: true }),
        attempt('new', 2, 500),
      ],
      POLICY,
      NOW,
    );
    expect(plan.prune).toEqual(['old']);
    expect(plan.keptBytes).toBe(1000);
  });

  it('with a backup configured, an old attempt whose bundle is not uploaded is spared by the age rule', () => {
    const plan = planPrune(
      [
        attempt('never', 45, 500, { bundleState: null }),
        attempt('pending', 45, 500, { bundleState: 'pending' }),
        attempt('done', 45, 500),
      ],
      { ...POLICY, protectUnbundled: true },
      NOW,
    );
    expect(plan.prune).toEqual(['done']);
    expect(plan.protectedCount).toBe(2);
  });

  it('…but not by the cap rule', () => {
    const plan = planPrune(
      [attempt('never', 10, 250, { bundleState: null }), attempt('done', 5, 100)],
      { pruneDays: 30, capBytes: 200, protectUnbundled: true },
      NOW,
    );
    expect(plan.prune).toEqual(['never']);
  });
});
