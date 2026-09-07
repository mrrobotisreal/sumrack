# Background music settings controls

Branch: `feature/ambient-music-controls` (from main). Date: 2026-09-07.

## Behavior

Settings → Background music now has:

- The existing Study ambience on/off switch.
- A native volume slider, shown only when music is on, with a visible
  percentage and 0–100% range in 1% steps. Default: 20%.
- A Play during narration switch, also shown only when music is on.
  Default: on. Off pauses the soundtrack during story narration and resumes
  the same music player when narration pauses or finishes.

Existing saved volume and master on/off selections are preserved. Legacy
15% Soft settings without the new narration field migrate to 20%, while a
manual 15% slider choice remains 15% through save/restart. Invalid settings
fall back to enabled, 20%, narration mixing on. No database migration is
needed: these preferences use the existing `audio.ambient` JSON setting.

Dragging updates the displayed percentage immediately and saves on release.
Keyboard and accessibility changes save without needing a touch gesture.
Settings does not preview the soundtrack; music resumes on a study screen.

The narration option does not bypass foreground/focus restrictions or the
existing pauses for word readouts, listening and pronunciation exercises.
Narration activity is tracked through pause, completion and unmount, including
readers retained beneath other screens. Music is paused, not rewound.

## Native dependency

Uses `@react-native-community/slider` 5.2.0, the
[Expo 57 compatible native slider](https://docs.expo.dev/versions/v57.0.0/sdk/slider/).
A native rebuild is required. No signing configuration changes were made.
The development-signed build matches the S25's existing installation and was
installed as an update without clearing app data.

## Verification

- Mobile TypeScript: passed.
- Scoped ESLint and formatting: passed.
- Full mobile suite: 74 test files, 657 tests passed.
- New regression coverage: narration on/off, resume when narration stops,
  foreground/speech restrictions, legacy preference migration, and arbitrary
  volume save/reload (including 15%, 37%, zero and 100%).
- Android assembly with the native slider: passed.
- Installation on Galaxy S25 `R3GYA00L1XX`: passed.
- On-device visual and interaction checks are pending phone unlock.

The feature remains uncommitted on its feature branch. Nothing has been
merged or pushed.
