/**
 * Progressive dashboard loading (T99) — the pure half: section ids, the
 * cheapest-first read priorities, status folding, the refocus rule, and a
 * per-visit tracker that turns query transitions into exactly-once
 * analytics. No React / expo imports so it is unit-tested in Node.
 */

export type DashboardSection =
  | 'vocab'
  | 'coreCoverage'
  | 'leeches'
  | 'needsWork'
  | 'forecast'
  | 'grammar'
  | 'activity'
  | 'heatmap'
  | 'assessment';

/** Every section, in on-screen order (unchanged from T18/T38). */
export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  'vocab',
  'coreCoverage',
  'leeches',
  'needsWork',
  'forecast',
  'grammar',
  'activity',
  'heatmap',
  'assessment',
];

/**
 * Read order on the shared background connection (lower runs first). Cheap
 * reads land first so the screen fills in visibly one card at a time; the
 * content-wide aggregations (vocab, core coverage, grammar) go last.
 */
export const READ_PRIORITY = {
  activity: 0,
  forecast: 1,
  heatmap: 2,
  leeches: 3,
  weakLemmas: 4,
  weakPronunciation: 5,
  pronunciation: 6,
  assessments: 7,
  checkpoints: 7,
  vocab: 8,
  coreCoverage: 9,
  coreGaps: 9,
  grammar: 10,
} as const;

export type SectionStatus = 'pending' | 'error' | 'success';

/** The slice of a React Query result the dashboard folds. */
export interface QueryLike {
  status: SectionStatus;
}

/**
 * A section's status from its queries: any error → error (an error must
 * never look empty), else any pending → pending, else success.
 */
export function foldStatus(queries: readonly QueryLike[]): SectionStatus {
  if (queries.some((q) => q.status === 'error')) return 'error';
  if (queries.some((q) => q.status === 'pending')) return 'pending';
  return 'success';
}

/**
 * Refocus rule (T99 decision 5): returning to the dashboard re-reads only
 * if the last refresh is older than {@link REFRESH_ON_FOCUS_MS}. Cached
 * cards stay on screen either way — a refetch never shows a skeleton.
 */
export const REFRESH_ON_FOCUS_MS = 30_000;

export function shouldRefreshOnFocus(lastRefreshAt: number | null, now: number): boolean {
  return lastRefreshAt == null || now - lastRefreshAt > REFRESH_ON_FOCUS_MS;
}

export type LoadEvent =
  | { kind: 'loaded'; section: DashboardSection; ms: number; cached: boolean }
  | { kind: 'failed'; section: DashboardSection }
  | { kind: 'ready'; ms: number; sections: number };

/**
 * One dashboard visit's load bookkeeping. Feed it every section's status on
 * each render; it returns the analytics events that became true since the
 * last call — each section's `loaded`/`failed` at most once per visit, and
 * one `ready` when every section has loaded. `cached` = the section already
 * had data at the visit's first observation (no skeleton was ever shown).
 */
export function createLoadTracker(startedAt: number) {
  const firstSeen = new Map<DashboardSection, SectionStatus>();
  const reported = new Set<DashboardSection>();
  const failed = new Set<DashboardSection>();
  let ready = false;

  return {
    observe(statuses: Record<DashboardSection, SectionStatus>, now: number): LoadEvent[] {
      const events: LoadEvent[] = [];
      for (const section of DASHBOARD_SECTIONS) {
        const status = statuses[section];
        if (!firstSeen.has(section)) firstSeen.set(section, status);
        if (status === 'success' && !reported.has(section)) {
          reported.add(section);
          events.push({
            kind: 'loaded',
            section,
            ms: Math.max(0, now - startedAt),
            cached: firstSeen.get(section) === 'success',
          });
        } else if (status === 'error' && !failed.has(section)) {
          failed.add(section);
          events.push({ kind: 'failed', section });
        }
      }
      if (!ready && reported.size === DASHBOARD_SECTIONS.length) {
        ready = true;
        events.push({ kind: 'ready', ms: Math.max(0, now - startedAt), sections: reported.size });
      }
      return events;
    },
    get isReady() {
      return ready;
    },
  };
}

/**
 * Tap → first-frame timing (`dashboard_first_paint`). The Today header
 * stamps the tap; the screen consumes it once on mount. A stamp older than
 * {@link TAP_STAMP_TTL_MS} (or none — a deep link) yields null.
 */
export const TAP_STAMP_TTL_MS = 10_000;
let tapStamp: number | null = null;

export function markDashboardTap(now = Date.now()): void {
  tapStamp = now;
}

export function consumeDashboardTap(now = Date.now()): number | null {
  const at = tapStamp;
  tapStamp = null;
  if (at == null || now - at > TAP_STAMP_TTL_MS) return null;
  return now - at;
}
