# sumrak-widget — home-screen widget (T40)

A Kotlin **Glance** home-screen widget for Сумрак: goal ring + streak flame + due-review count, with tap targets for the daily session and the continue-reading story. The widget never touches the database. The app writes a tiny JSON snapshot into SharedPreferences, and the widget renders only that snapshot.

The JS surface is `index.ts` (typed `requireNativeModule`). The device writer lives in `apps/mobile/src/features/motivation/widget-sync.ts`. This module stays a thin native wrapper.

## Cross-process contract

| Item                   | Value           | Kotlin (`WidgetContract.kt`) | TS (`widget-contract.ts`) |
| ---------------------- | --------------- | ---------------------------- | ------------------------- |
| SharedPreferences file | `sumrak_widget` | `PREFS_NAME`                 | `WIDGET_PREFS_NAME`       |
| Key (JSON string)      | `snapshot`      | `KEY_SNAPSHOT`               | `WIDGET_SNAPSHOT_KEY`     |
| Schema version         | `1`             | `SNAPSHOT_VERSION`           | `WIDGET_SNAPSHOT_VERSION` |
| Stale window           | 36 h            | `STALE_MS`                   | `WIDGET_STALE_MS`         |

The snapshot schema is `WidgetSnapshotSchema` in `widget-snapshot.ts`: `{ v, streak, dueCount, goal: { reviewsDone, reviewsTarget, readingMinDone, readingMinTarget, met, questProgress? }, continueReading: {packId, storyId, title} | null, updatedAtMs }`. `questProgress` is reserved for T34's quest registry, which does not exist yet, so it is always omitted.

`SnapshotStore.kt` parses it defensively. A missing or mistyped field, or malformed JSON, is reported as `Corrupt` and never thrown. An empty string clears the key, which reads as `Missing`.

`widget-contract.ts` and `WidgetContract.kt` each point at the other, and `widget-snapshot.test.ts` reads the Kotlin file and asserts the literals match the TS constants.

## How it survives `expo prebuild`

`android/` is generated and gitignored, so nothing in it can be relied on. Everything the widget needs lives in this directory:

1. **Autolinking.** Expo discovers `modules/*/expo-module.config.json` automatically. Verify with `npx expo-modules-autolinking resolve -p android | grep -i widget`.
2. **Receiver and resources via the module's own manifest.** `android/src/main/AndroidManifest.xml` declares `SumrakWidgetReceiver`. Library manifests merge into the app's manifest on every build, so the receiver is recreated after `prebuild --clean`. There is no config plugin and no edit to the generated `android/`.
3. **Glance and Compose.** `android/build.gradle` applies the Compose compiler plugin the way `@expo/ui` does, enables `buildFeatures { compose true }`, and depends on `androidx.glance:glance-appwidget:1.1.1` and `glance-material3:1.1.1`.

Verified 2026-10-09: `npx expo prebuild --platform android --clean --no-install` followed by `cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew :app:assembleDebug -x lint` passed, and the merged manifest contains `SumrakWidgetReceiver`. A second `--clean` prebuild and a fresh assemble also passed. The debug APK is 139,283,221 bytes (132.8 MB).

## Ring decision

Glance cannot draw arcs, so `GoalRing.kt` renders the ring as a bitmap with `Canvas.drawArc` (10 % stroke, round caps, starting at −90°) and displays it through an `Image`. If the bitmap route fails, the widget falls back to Glance's `LinearProgressIndicator` (the segmented-bar fallback).

## States

- **Normal**: ring, streak, and due count are shown. The card taps through to the continue-reading story, or to the daily session when there is none.
- **Stale** (`now - updatedAtMs > 36 h`): numbers dim to the muted colour and «открой приложение» appears.
- **Missing** (no snapshot, fresh install, app never run) and **Corrupt** (malformed JSON): both show the «Открой Сумрак» placeholder, which opens the app. Neither crashes.
- Any composition failure also falls back to the placeholder.

## Triggers

The writer `refreshWidgetSnapshot()` runs on these events. This is the T19 replan set:

- end of `evaluateMotivation()`, which runs after every daily-activity change, including each graded review and goal-met;
- `onSessionEnded()`;
- `initMotivation()` at boot;
- mount and `AppState 'active'` in `reminder-replanner.tsx`.

`service.ts` calls `requestWidgetRefresh()` from `widget-bus.ts`. `DbProvider` installs the real writer with `setWidgetRefresher` before `initMotivation()`. This keeps `@/db` out of the vitest import graph. Concurrent calls coalesce into one follow-up run. There is no analytics event per write.

The native `writeSnapshot` commits with `commit()` and then refreshes every placed instance through `GlanceAppWidgetManager.getGlanceIds` plus `update`. Failures are logged and never thrown into JS. The widget also refreshes itself every 30 minutes (`updatePeriodMillis=1800000`), so stale state shows up without the app running.

## Deep links

Taps use `sumrak://review/daily?from=widget` and `sumrak://reader/<packId>/<storyId>?from=widget`, with ids URL-encoded. `WidgetLinkTracker` (mounted in `_layout.tsx`) records `widget_opened` with `{ screen, from: 'widget' }` once per URL. expo-router does the navigation; the tracker never pushes a route.

## Rebuild steps (native change)

After any change under `modules/sumrak-widget/android/`:

```sh
cd apps/mobile
npx expo prebuild --platform android --clean --no-install
cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew :app:assembleDebug -x lint
```

The `*.kt` and `res/` changes need a rebuilt dev client. The orchestrator installs it; this module does not.

## Verify the cross-process contract

On a debuggable build:

```sh
adb exec-out run-as io.winapps.sumrak cat shared_prefs/sumrak_widget.xml
```

To demo each state, use the `__DEV__` **Widget (T40)** section on the dev-db screen:

- **Write snapshot now** refreshes from live data.
- **Write stale snapshot (−48 h)** shows the stale state.
- **Write corrupt snapshot** writes `{"v":1,"streak":"oops"` and should show the placeholder.
- **Clear snapshot** writes an empty string and should show the placeholder.

The dev-db buttons call `writeSnapshot` directly. An older dev client without this module reports "native module missing" rather than crashing.
