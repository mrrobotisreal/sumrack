import { describe, expect, it } from 'vitest';

import {
  consumeDashboardTap,
  createLoadTracker,
  DASHBOARD_SECTIONS,
  foldStatus,
  markDashboardTap,
  READ_PRIORITY,
  shouldRefreshOnFocus,
  type DashboardSection,
  type SectionStatus,
} from '../load-state';

const all = (status: SectionStatus) =>
  Object.fromEntries(DASHBOARD_SECTIONS.map((s) => [s, status])) as Record<
    DashboardSection,
    SectionStatus
  >;

describe('T99 progressive dashboard — pure rules', () => {
  it('reads cheapest-first: the content-wide aggregations run last, grammar very last', () => {
    const p = READ_PRIORITY;
    const cheap = [
      p.activity,
      p.forecast,
      p.heatmap,
      p.leeches,
      p.weakLemmas,
      p.weakPronunciation,
      p.pronunciation,
      p.assessments,
      p.checkpoints,
    ];
    for (const c of cheap) {
      expect(c).toBeLessThan(p.vocab);
    }
    expect(p.activity).toBe(0);
    expect(p.vocab).toBeLessThan(p.coreCoverage);
    expect(p.coreCoverage).toBeLessThan(p.grammar);
    expect(Math.max(...Object.values(p))).toBe(p.grammar);
  });

  it('foldStatus: error beats pending beats success', () => {
    expect(foldStatus([{ status: 'success' }, { status: 'pending' }])).toBe('pending');
    expect(foldStatus([{ status: 'pending' }, { status: 'error' }])).toBe('error');
    expect(foldStatus([{ status: 'success' }, { status: 'success' }])).toBe('success');
    expect(foldStatus([])).toBe('success');
  });

  it('refocus re-reads only after 30 s (cached cards stay either way)', () => {
    expect(shouldRefreshOnFocus(null, 1_000)).toBe(true);
    expect(shouldRefreshOnFocus(1_000, 20_000)).toBe(false);
    expect(shouldRefreshOnFocus(1_000, 31_001)).toBe(true);
  });

  it('tracker: sections report loaded once each, in arrival order, then one ready', () => {
    const t = createLoadTracker(1_000);
    const s = all('pending');
    expect(t.observe(s, 1_010)).toEqual([]);

    s.activity = 'success';
    expect(t.observe(s, 1_050)).toEqual([
      { kind: 'loaded', section: 'activity', ms: 50, cached: false },
    ]);
    // Re-render with no change → nothing new.
    expect(t.observe(s, 1_060)).toEqual([]);

    s.grammar = 'error';
    expect(t.observe(s, 1_070)).toEqual([{ kind: 'failed', section: 'grammar' }]);
    expect(t.observe(s, 1_080)).toEqual([]);

    // Retry succeeds; everything else lands.
    const done = all('success');
    const events = t.observe(done, 2_500);
    expect(events.filter((e) => e.kind === 'loaded')).toHaveLength(DASHBOARD_SECTIONS.length - 1);
    expect(events.at(-1)).toEqual({ kind: 'ready', ms: 1_500, sections: 9 });
    expect(t.isReady).toBe(true);
    expect(t.observe(done, 3_000)).toEqual([]);
  });

  it('tracker: a section with data at the first observation is cached (no skeleton shown)', () => {
    const t = createLoadTracker(0);
    const events = t.observe(all('success'), 5);
    expect(
      events.filter((e) => e.kind === 'loaded').every((e) => e.kind === 'loaded' && e.cached),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: 'ready', ms: 5 });
  });

  it('tap stamp: consumed once, ignored when stale', () => {
    markDashboardTap(1_000);
    expect(consumeDashboardTap(1_120)).toBe(120);
    expect(consumeDashboardTap(1_200)).toBeNull();
    markDashboardTap(1_000);
    expect(consumeDashboardTap(20_000)).toBeNull();
  });
});
