import * as Notifications from 'expo-notifications';
import { z } from 'zod';

import { repos } from '@/db';
import { localDateKey } from '@/db/repositories/stats';
import { UNIFIED_SESSION_DIRECTIONS } from '@/db/repositories/reviews';
import { computeStreak } from '@/lib/streak';
import { track } from '@/services/analytics';
import { useNotificationPrefs } from '@/store/notification-prefs';

import {
  planNewContent,
  planReminders,
  T19_ID_PREFIX,
  type PlannedNotification,
} from './notification-plan';

/**
 * expo-notifications glue (T19): executes plans from notification-plan.ts.
 * Everything is local scheduling — no push, no server (ticket out-of-scope).
 * Replans run cancel-ours-then-reschedule and are serialized; they are
 * triggered on bootstrap, app foreground, after motivation evaluation, and
 * on prefs changes.
 */

const CHANNEL_REMINDERS = 'reminders';
const CHANNEL_CONTENT = 'content';

/** How many upcoming mornings get a queue-ready reminder pre-scheduled. */
const MORNINGS_AHEAD = 3;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let channelsReady = false;
async function ensureChannels(): Promise<void> {
  if (channelsReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: undefined,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_CONTENT, {
    name: 'New content',
    importance: Notifications.AndroidImportance.LOW,
  });
  channelsReady = true;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermission(): Promise<PermissionState> {
  const res = await Notifications.getPermissionsAsync();
  if (res.granted) return 'granted';
  return res.canAskAgain ? 'undetermined' : 'denied';
}

/** Request the OS permission (the master-toggle / Today-card first touch). */
export async function requestNotificationPermission(): Promise<PermissionState> {
  const res = await Notifications.requestPermissionsAsync();
  const state: PermissionState = res.granted
    ? 'granted'
    : res.canAskAgain
      ? 'undetermined'
      : 'denied';
  track('notification_permission_result', { state });
  return state;
}

async function cancelOurScheduled(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.identifier.startsWith(T19_ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

async function schedule(item: PlannedNotification, channelId: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: item.id,
    content: {
      title: item.title,
      body: item.body,
      data: { screen: item.screen },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: item.date,
      channelId,
    },
  });
}

function atHour(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

let replanChain: Promise<void> = Promise.resolve();

/**
 * Recompute + reschedule the morning/evening reminders from current state.
 * Safe to call often; serialized so overlapping calls can't double-book.
 */
export function replanReminders(): Promise<void> {
  replanChain = replanChain
    .then(() => doReplan())
    .catch((err) => {
      console.warn('[notifications] replan failed', err);
    });
  return replanChain;
}

async function doReplan(): Promise<void> {
  const prefs = useNotificationPrefs.getState().prefs;
  if (!prefs.enabled || (await getNotificationPermission()) !== 'granted') {
    await cancelOurScheduled();
    return;
  }
  await ensureChannels();

  const now = new Date();
  const todayKey = localDateKey(now);

  const morningDates: Date[] = [];
  for (let i = 0; i <= MORNINGS_AHEAD; i++) {
    const d = atHour(now, i, prefs.morningHour);
    if (d.getTime() > now.getTime()) morningDates.push(d);
    if (morningDates.length >= MORNINGS_AHEAD) break;
  }
  const mornings = await Promise.all(
    morningDates.map(async (date) => ({
      date,
      dueCount: await repos.reviews.countDueCards({
        now: date.getTime(),
        directions: UNIFIED_SESSION_DIRECTIONS,
      }),
    })),
  );

  const [days, activity] = await Promise.all([
    repos.stats.getStreakDays(),
    repos.stats.getDailyActivity(todayKey),
  ]);
  const streak = computeStreak(todayKey, days);

  const plan = planReminders({
    now,
    prefs,
    mornings,
    evenings: [atHour(now, 0, prefs.eveningHour), atHour(now, 1, prefs.eveningHour)],
    streakDays: streak.current,
    goalMetToday: activity?.goalMetAt != null,
  });

  await cancelOurScheduled();
  for (const item of plan) {
    await schedule(item, CHANNEL_REMINDERS);
  }
  track('notifications_replanned', {
    scheduled: plan.length,
    streakDays: streak.current,
    goalMetToday: activity?.goalMetAt != null,
  });
}

/** Post-sync "new packs available" notice (called by the sync service). */
export async function notifyNewContent(installedCount: number): Promise<void> {
  try {
    const prefs = useNotificationPrefs.getState().prefs;
    if (!prefs.enabled || (await getNotificationPermission()) !== 'granted') return;
    const item = planNewContent({ now: new Date(), prefs, installedCount });
    if (!item) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      identifier: item.id,
      content: { title: item.title, body: item.body, data: { screen: item.screen } },
      trigger: null, // present immediately
    });
    track('notification_new_content', { installedCount });
  } catch (err) {
    console.warn('[notifications] new-content notice failed', err);
  }
}

/** Deep-link payload — Zod-gated so a malformed payload can never crash routing. */
const PayloadSchema = z.object({ screen: z.enum(['today', 'library']) });

export function screenFromResponse(
  response: Notifications.NotificationResponse,
): 'today' | 'library' | null {
  const parsed = PayloadSchema.safeParse(response.notification.request.content.data);
  return parsed.success ? parsed.data.screen : null;
}
