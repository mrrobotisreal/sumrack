package expo.modules.sumrakwidget

// Cross-process contract for the home-screen widget (T40). Mirror of
// apps/mobile/src/features/motivation/widget-contract.ts — keep both in sync
// (widget-snapshot.test.ts asserts these literals against the TS constants).

/** SharedPreferences file name. */
const val PREFS_NAME = "sumrak_widget"

/** SharedPreferences key holding the JSON snapshot string. */
const val KEY_SNAPSHOT = "snapshot"

/** Snapshot schema version (`v` field). */
const val SNAPSHOT_VERSION = 1

/** Older than this → the widget dims its numbers and asks for the app. */
const val STALE_MS = 36L * 3600_000L
