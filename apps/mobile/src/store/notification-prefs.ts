import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  DEFAULT_NOTIFICATION_PREFS,
  parseNotificationPrefs,
  type NotificationPrefs,
} from '@/features/motivation/notification-prefs';
import { track } from '@/services/analytics';

/**
 * Notification prefs (T19) — hydrated by DbProvider, written through to the
 * settings table, Zod-healed on read (the T13/T14 prefs pattern). The
 * scheduling side effects (permission request, replans) live in
 * features/motivation/notifications.ts, not here.
 */
interface NotificationPrefsState {
  prefs: NotificationPrefs;
  setPrefs: (patch: Partial<NotificationPrefs>) => void;
}

export const useNotificationPrefs = create<NotificationPrefsState>((set, get) => ({
  prefs: DEFAULT_NOTIFICATION_PREFS,
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    for (const [setting, value] of Object.entries(patch)) {
      track('notification_prefs_changed', { setting, value: Number(value) });
    }
    void repos.settings.set(SETTING_KEYS.notificationPrefs, prefs);
  },
}));

/** Load persisted prefs after the DB is ready (called by DbProvider). */
export async function hydrateNotificationPrefsFromDb(): Promise<void> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.notificationPrefs);
  if (stored != null) {
    useNotificationPrefs.setState({ prefs: parseNotificationPrefs(stored) });
  }
}
