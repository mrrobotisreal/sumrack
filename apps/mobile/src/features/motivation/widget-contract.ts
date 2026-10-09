/**
 * Cross-process contract for the home-screen widget (T40). The widget process
 * reads ONLY the SharedPreferences snapshot — never the DB. The Kotlin mirror
 * is `modules/sumrak-widget/android/src/main/java/expo/modules/sumrakwidget/WidgetContract.kt`;
 * keep both in sync (widget-snapshot.test.ts asserts the Kotlin literals).
 */

/** SharedPreferences file name (Kotlin: `PREFS_NAME`). */
export const WIDGET_PREFS_NAME = 'sumrak_widget';

/** SharedPreferences key holding the JSON snapshot string (Kotlin: `KEY_SNAPSHOT`). */
export const WIDGET_SNAPSHOT_KEY = 'snapshot';

/** Snapshot schema version (Kotlin: `SNAPSHOT_VERSION`). */
export const WIDGET_SNAPSHOT_VERSION = 1;

/** Older than this → the widget dims its numbers and asks for the app (Kotlin: `STALE_MS`). */
export const WIDGET_STALE_MS = 36 * 3600_000;
