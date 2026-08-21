/**
 * Local analytics (workspace requirement: exceptional tracking even though
 * single-user). track() is safe to call from anywhere at any time: events
 * queue in memory until the DB is ready, then the bootstrap installs a sink
 * that persists every event to the `analytics_events` table (queried by the
 * progress engine / dashboard in T18+).
 */
export type AnalyticsEvent =
  | 'app_opened'
  | 'theme_mode_changed'
  | 'tab_viewed'
  | 'settings_opened'
  | 'pack_imported'
  | 'pack_removed'
  | 'debug_db_opened'
  | 'debug_db_search'
  | 'story_opened'
  | 'story_finished'
  | 'reading_session_ended'
  | 'reading_position_restored'
  | 'sentence_reveal_toggled'
  | 'reveal_all_toggled'
  | 'reader_typography_changed';

export type AnalyticsProps = Record<string, string | number | boolean>;

type Sink = (event: AnalyticsEvent, props?: AnalyticsProps) => void;

let sink: Sink | null = null;
const pending: [AnalyticsEvent, AnalyticsProps | undefined][] = [];

export function track(event: AnalyticsEvent, props?: AnalyticsProps) {
  if (__DEV__) {
    console.log(`[analytics] ${event}`, props ?? {});
  }
  if (sink) {
    sink(event, props);
  } else {
    pending.push([event, props]);
  }
}

/** Install the persistence sink (bootstrap) and flush anything queued before it. */
export function initAnalyticsSink(s: Sink) {
  sink = s;
  for (const [event, props] of pending.splice(0)) {
    s(event, props);
  }
}
