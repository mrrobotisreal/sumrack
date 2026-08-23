import { z } from 'zod';

/**
 * Local-notification preferences (T19, §7.7). One settings row
 * (SETTING_KEYS.notificationPrefs), Zod-validated on read. `enabled` is the
 * master toggle — it starts OFF and flipping it on is the permission
 * first-touch point (never prompted on cold launch, ticket item 7).
 * Hours are device-local (the same "wall clock" identity the streak uses).
 */
const HourSchema = z.number().int().min(0).max(23);

export const NotificationPrefsSchema = z.strictObject({
  enabled: z.boolean(),
  /** Morning "review queue ready" reminder hour. */
  morningHour: HourSchema,
  /** Evening "streak at risk" reminder hour. */
  eveningHour: HourSchema,
  /** Quiet hours window [start, end); start === end disables the window. */
  quietStartHour: HourSchema,
  quietEndHour: HourSchema,
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  morningHour: 9,
  eveningHour: 20,
  quietStartHour: 22,
  quietEndHour: 8,
};

export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const parsed = NotificationPrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_PREFS;
}

/** Whether `date`'s local hour falls inside the quiet window (may span midnight). */
export function inQuietHours(prefs: NotificationPrefs, date: Date): boolean {
  const h = date.getHours();
  const { quietStartHour: start, quietEndHour: end } = prefs;
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}
