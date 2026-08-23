import { parseBackupFileName } from './naming';

/**
 * Ring-buffer retention (design §9, ticket item 6): keep every backup from
 * the 30 most recent distinct UTC dates present in the store, and beyond
 * that window one per calendar month (the month's latest). Everything else
 * is prunable.
 *
 * Deliberately pure over *names only*: age comes from the UTC timestamp
 * embedded in each file name, never from the device clock — so a wrong
 * clock or timezone flip (T19's travel case) can't delete something still
 * needed. The newest backup is always inside the newest-30-dates set by
 * construction, and files whose names don't parse are never touched.
 */
export const RETENTION_DAILY_DAYS = 30;

export interface RetentionPlan {
  keep: string[];
  prune: string[];
}

export function planRetention(names: string[]): RetentionPlan {
  const parsed = names
    .map(parseBackupFileName)
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const unparseable = names.filter((n) => parseBackupFileName(n) === null);

  const recentDates = [...new Set(parsed.map((p) => p.dateKey))]
    .sort()
    .reverse()
    .slice(0, RETENTION_DAILY_DAYS);
  const recentDateSet = new Set(recentDates);

  const keep = new Set<string>(unparseable);
  // Latest backup per month among the older-than-30-dates files.
  const monthlyKeeper = new Map<string, { name: string; timestamp: number }>();

  for (const p of parsed) {
    if (recentDateSet.has(p.dateKey)) {
      keep.add(p.name);
    } else {
      const best = monthlyKeeper.get(p.monthKey);
      if (!best || p.timestamp > best.timestamp) {
        monthlyKeeper.set(p.monthKey, { name: p.name, timestamp: p.timestamp });
      }
    }
  }
  for (const { name } of monthlyKeeper.values()) keep.add(name);

  return {
    keep: names.filter((n) => keep.has(n)),
    prune: names.filter((n) => !keep.has(n)),
  };
}
