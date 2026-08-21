/**
 * Local analytics — convention stub (T01).
 *
 * Sumrak is single-user and offline-first, but good local analytics are a
 * project requirement (workspace CLAUDE.md). Every feature ticket funnels
 * user actions through track(); T03 will persist events to SQLite so the
 * progress engine and dashboard can query them. Until then: dev log only.
 */
export type AnalyticsEvent = 'app_opened' | 'theme_mode_changed' | 'tab_viewed' | 'settings_opened';

export function track(event: AnalyticsEvent, props?: Record<string, string | number | boolean>) {
  if (__DEV__) {
    console.log(`[analytics] ${event}`, props ?? {});
  }
  // T03: insert into the local analytics_events table.
}
