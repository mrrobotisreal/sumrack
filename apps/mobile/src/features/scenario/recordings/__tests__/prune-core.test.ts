import { describe, expect, it } from 'vitest';

import { planPrune, type PruneCandidate } from '../prune-core';

/**
 * T63 §10.1: the pure prune planner — age rule, cap rule, pins, the
 * unbundled protection, rows never in scope (the service flips them).
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function run(
  id: string,
  ageDays: number,
  bytes: number,
  extra: Partial<PruneCandidate> = {},
): PruneCandidate {
  const at = NOW - ageDays * DAY;
  return {
    runId: id,
    startedAt: at - 60_000,
    finishedAt: at,
    pinned: false,
    bytes,
    bundleState: 'uploaded',
    ...extra,
  };
}

const POLICY = { pruneDays: 30, capBytes: 300_000_000 };

describe('planPrune — age rule', () => {
  it('prunes unpinned runs older than pruneDays, keeps younger ones', () => {
    const plan = planPrune([run('old', 45, 100), run('young', 3, 100)], POLICY, NOW);
    expect(plan.prune).toEqual(['old']);
    expect(plan.bytesFreed).toBe(100);
    expect(plan.keptBytes).toBe(100);
  });

  it('never plans a pinned run, however old', () => {
    const plan = planPrune([run('pinned', 400, 5_000, { pinned: true })], POLICY, NOW);
    expect(plan.prune).toEqual([]);
    expect(plan.keptBytes).toBe(5_000);
  });

  it('uses finishedAt as the age anchor, startedAt for unfinished runs', () => {
    const unfinishedOld = run('u', 40, 100, { finishedAt: null, startedAt: NOW - 40 * DAY });
    const finishedRecently = run('f', 1, 100, { startedAt: NOW - 90 * DAY });
    const plan = planPrune([unfinishedOld, finishedRecently], POLICY, NOW);
    expect(plan.prune).toEqual(['u']);
  });

  it('ignores runs with no bytes on disk', () => {
    const plan = planPrune([run('gone', 90, 0)], POLICY, NOW);
    expect(plan.prune).toEqual([]);
  });
});

describe('planPrune — cap rule', () => {
  it('takes the oldest unpinned finished runs until under the cap', () => {
    const runs = [run('a', 10, 100), run('b', 8, 100), run('c', 6, 100), run('d', 4, 100)];
    const plan = planPrune(runs, { pruneDays: 30, capBytes: 250 }, NOW);
    expect(plan.prune).toEqual(['a', 'b']);
    expect(plan.keptBytes).toBe(200);
    expect(plan.bytesFreed).toBe(200);
  });

  it('skips pinned and unfinished runs when filling the cap (they still count toward it)', () => {
    const runs = [
      run('pinned', 10, 200, { pinned: true }),
      run('open', 9, 200, { finishedAt: null, startedAt: NOW - 9 * DAY }),
      run('c', 6, 100),
    ];
    const plan = planPrune(runs, { pruneDays: 30, capBytes: 250 }, NOW);
    expect(plan.prune).toEqual(['c']);
    expect(plan.keptBytes).toBe(400); // pinned + open — over the cap, but nothing else may go
  });

  it('age-pruned bytes count before the cap rule runs', () => {
    const runs = [run('old', 60, 200), run('b', 8, 100), run('c', 4, 100)];
    const plan = planPrune(runs, { pruneDays: 30, capBytes: 200 }, NOW);
    expect(plan.prune).toEqual(['old']);
    expect(plan.keptBytes).toBe(200);
  });
});

describe('planPrune — unbundled protection', () => {
  it('with protectUnbundled, the age rule spares pending / failed / unbundled runs and counts them', () => {
    const runs = [
      run('pending', 45, 100, { bundleState: 'pending' }),
      run('failed', 45, 100, { bundleState: 'failed' }),
      run('never', 45, 100, { bundleState: null }),
      run('safe', 45, 100, { bundleState: 'uploaded' }),
    ];
    const plan = planPrune(runs, { ...POLICY, protectUnbundled: true }, NOW);
    expect(plan.prune).toEqual(['safe']);
    expect(plan.protectedCount).toBe(3);
  });

  it('the cap rule still takes protected runs (a failing target cannot grow the folder unbounded)', () => {
    const runs = [run('pending', 45, 200, { bundleState: 'pending' }), run('b', 1, 200)];
    const plan = planPrune(runs, { pruneDays: 30, capBytes: 250, protectUnbundled: true }, NOW);
    expect(plan.prune).toEqual(['pending']);
    expect(plan.protectedCount).toBe(1);
  });

  it('without protectUnbundled (no backup target), nothing is protected', () => {
    const plan = planPrune([run('never', 45, 100, { bundleState: null })], POLICY, NOW);
    expect(plan.prune).toEqual(['never']);
    expect(plan.protectedCount).toBe(0);
  });
});

describe('planPrune — the ticket scenario', () => {
  it('ten planted old runs go; a pinned one and a fresh one stay', () => {
    const runs = [
      ...Array.from({ length: 10 }, (_, i) => run(`old-${i}`, 31 + i, 20_000)),
      run('pinned-old', 60, 20_000, { pinned: true }),
      run('fresh', 0, 20_000),
    ];
    const plan = planPrune(runs, POLICY, NOW);
    expect(plan.prune).toHaveLength(10);
    expect(plan.prune.every((id) => id.startsWith('old-'))).toBe(true);
    expect(plan.bytesFreed).toBe(200_000);
    expect(plan.keptBytes).toBe(40_000);
  });
});
