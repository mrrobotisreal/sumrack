import { inQuietHours, type NotificationPrefs } from './notification-prefs';

/**
 * Pure notification planning (T19) — decides WHAT to schedule; the
 * expo-notifications glue (notifications.ts) only executes the plan. Local
 * notifications carry content fixed at schedule time, so the plan is
 * recomputed (cancel-ours-then-reschedule) on app open/foreground, after
 * activity, and on prefs changes — the standard local-reminder pattern.
 *
 * Quiet-hours rules (recorded decisions):
 *  - morning reminder inside quiet hours → pushed to the quiet-hours end;
 *  - evening streak-at-risk inside quiet hours → pulled 15 min BEFORE quiet
 *    start (a 2 a.m. "your streak is at risk" is worse than none); dropped
 *    if that lands in the past;
 *  - immediate new-content notice inside quiet hours → skipped entirely
 *    (informational only — Library shows it anyway).
 */
export interface PlannedNotification {
  /** Stable identifier, always T19_ID_PREFIX-prefixed (reschedule = cancel by prefix). */
  id: string;
  date: Date;
  title: string;
  body: string;
  /** Deep-link target validated on tap (notifications.ts). */
  screen: 'today' | 'library';
}

export const T19_ID_PREFIX = 't19-';

function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface ReminderPlanInput {
  now: Date;
  prefs: NotificationPrefs;
  /** Candidate morning fire times (already at morningHour) + due count predicted for each. */
  mornings: { date: Date; dueCount: number }[];
  /** Candidate evening fire times (already at eveningHour), today first. */
  evenings: Date[];
  /** Current streak length (today counted or anchored at yesterday). */
  streakDays: number;
  goalMetToday: boolean;
}

export function planReminders(input: ReminderPlanInput): PlannedNotification[] {
  const { now, prefs, mornings, evenings, streakDays, goalMetToday } = input;
  if (!prefs.enabled) return [];
  const plan: PlannedNotification[] = [];

  // Morning queue-ready — only when cards are actually due by then (ticket 6a).
  for (const { date, dueCount } of mornings) {
    if (dueCount <= 0) continue;
    let fireAt = date;
    if (inQuietHours(prefs, fireAt)) {
      fireAt = new Date(fireAt);
      fireAt.setHours(prefs.quietEndHour, 0, 0, 0);
    }
    if (fireAt.getTime() <= now.getTime()) continue;
    plan.push({
      id: `${T19_ID_PREFIX}morning-${dayKeyOf(fireAt)}`,
      date: fireAt,
      title: 'Ваши карточки ждут',
      body:
        dueCount === 1 ? '1 card is ready to review.' : `${dueCount} cards are ready to review.`,
      screen: 'today',
    });
  }

  // Evening streak-at-risk — only while a streak is live (ticket 6b). Today's
  // fires only if the goal isn't met yet; tomorrow's is pre-scheduled only
  // when today already counts (otherwise the streak may not survive into
  // tomorrow), and any activity tomorrow replans it away once the goal lands.
  if (streakDays > 0) {
    for (const [i, candidate] of evenings.entries()) {
      const isToday = i === 0;
      if (isToday && goalMetToday) continue;
      if (!isToday && !goalMetToday) continue;
      let fireAt = candidate;
      if (inQuietHours(prefs, fireAt)) {
        fireAt = new Date(fireAt);
        fireAt.setHours(prefs.quietStartHour, 0, 0, 0);
        fireAt.setMinutes(-15);
        if (inQuietHours(prefs, fireAt)) continue; // hostile config — drop
      }
      if (fireAt.getTime() <= now.getTime()) continue;
      plan.push({
        id: `${T19_ID_PREFIX}evening-${dayKeyOf(candidate)}`,
        date: fireAt,
        title: 'Серия под угрозой',
        body:
          streakDays === 1
            ? 'Your streak is at risk — meet today’s goal to keep it alive.'
            : `Your ${streakDays}-day streak is at risk — meet today’s goal to keep it alive.`,
        screen: 'today',
      });
    }
  }

  return plan;
}

/** The immediate post-sync new-content notice, or null when suppressed. */
export function planNewContent(input: {
  now: Date;
  prefs: NotificationPrefs;
  installedCount: number;
}): PlannedNotification | null {
  const { now, prefs, installedCount } = input;
  if (!prefs.enabled || installedCount <= 0) return null;
  if (inQuietHours(prefs, now)) return null;
  return {
    id: `${T19_ID_PREFIX}new-content-${now.getTime()}`,
    date: now,
    title: 'Новые истории',
    body:
      installedCount === 1
        ? 'A new content pack was installed — fresh reading awaits.'
        : `${installedCount} new content packs were installed — fresh reading awaits.`,
    screen: 'library',
  };
}
