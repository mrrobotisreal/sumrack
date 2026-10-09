import { requireOptionalNativeModule } from 'expo';

import { repos } from '@/db';
import { UNIFIED_SESSION_DIRECTIONS } from '@/db/repositories/reviews';
import { localDateKey } from '@/db/repositories/stats';
import { computeStreak } from '@/lib/streak';
import { logError } from '@/services/error-log';
import { useGoalPrefs } from '@/store/goal-prefs';

import { WidgetSnapshotSchema, buildWidgetSnapshot } from './widget-snapshot';

/**
 * Device-side writer for the home-screen widget snapshot (T40). Gathers the
 * same inputs the Today screen uses, Zod-validates the snapshot, and hands the
 * JSON to the native `SumrakWidget` module. Fire-and-forget: every error is
 * swallowed into the error log, and there is no analytics event per write.
 *
 * The native module is loaded OPTIONALLY so a dev client built before the
 * module existed no-ops instead of crashing (`requireNativeModule` would throw).
 */

interface SumrakWidgetNative {
  writeSnapshot(json: string): void;
}

const native = requireOptionalNativeModule<SumrakWidgetNative>('SumrakWidget');

let inFlight = false;
let pending = false;

async function gather(now: number) {
  const todayKey = localDateKey(new Date(now));
  const goal = useGoalPrefs.getState().goal;
  const [days, dueCount, activity, continueReading] = await Promise.all([
    repos.stats.getStreakDays(),
    repos.reviews.countDueCards({ directions: UNIFIED_SESSION_DIRECTIONS }),
    repos.stats.getDailyActivity(todayKey),
    repos.reading.getContinueTarget(),
  ]);
  const streak = computeStreak(todayKey, days).current;
  const reviewsDone = activity?.reviewsDone ?? 0;
  const readingMs = activity?.readingMs ?? 0;
  // The stamped goal-met day (Today's `goalMetToday`), never a recomputation.
  const goalMet = days.met.has(todayKey);
  return buildWidgetSnapshot({
    streak,
    dueCount,
    reviewsDone,
    readingMs,
    goal,
    goalMet,
    continueReading,
    now,
  });
}

async function writeOnce(): Promise<void> {
  if (!native) return;
  const snapshot = WidgetSnapshotSchema.parse(await gather(Date.now()));
  native.writeSnapshot(JSON.stringify(snapshot));
}

/**
 * Refresh the widget snapshot. Calls that arrive while a write is in flight
 * collapse into exactly one follow-up run after it finishes, so the final
 * snapshot always reflects the latest state without piling up writes.
 */
export function refreshWidgetSnapshot(): void {
  if (!native) return;
  if (inFlight) {
    pending = true;
    return;
  }
  inFlight = true;
  void (async () => {
    try {
      do {
        pending = false;
        try {
          await writeOnce();
        } catch (err) {
          logError('manual', err);
        }
      } while (pending);
    } finally {
      inFlight = false;
    }
  })();
}
