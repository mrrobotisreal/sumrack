# Quiet background music for study

Branch: `feature/ambient-study-music`

## Current setup

Sumrak is a pnpm monorepo. The Expo 57 / React Native app is in
`apps/mobile`, with Expo Router navigation, Zustand UI state, and SQLite
settings hydrated by `DbProvider` before screens mount. `expo-audio` is
already installed. Reader narration owns a player with karaoke, word
segments, background playback and lock-screen controls. Speech uses Piper
through SherpaSpeech, falling back to expo-speech. Games reuse `SessionShell`;
loading, empty, failure and results screens render outside it.

## Playback behavior

- Bundle the supplied MP3 inside the mobile app for offline use. It is
  unchanged: 800.026 seconds, stereo 44.1 kHz, 320 kbps, 32,002,132 bytes.
- Default enabled at 8% player gain. Settings → Background music offers
  an off switch and Very quiet (4%), Quiet (8%), Soft (20%) levels.
  The previous 15% Soft setting upgrades automatically to 20% on load.
  These gains multiply the device's media volume; they are not perceived
  loudness percentages. Stored values are validated and capped at 20%.
- Start once a focused reader has loaded and restored its visible text,
  or when a focused `SessionShell` is mounted for an actual exercise.
  This includes flashcards, multiple choice, cloze, sentence builder,
  mixed daily sessions, path quizzes and checkpoints.
- Keep music playing at its selected level alongside story narration.
  Playing, pausing or finishing narration does not restart or duck the music.
- Pause for reader lookup/explanation/typography sheets and Piper or system
  speech. Story narration is a separate audio player, not a speech blocker.
- Keep listening and pronunciation exercises silent for their entire
  focused lifetime, including replay and recording. Daily sessions resume
  music when they return to a non-listening exercise.
- No music on library browsing, game menus, loading/empty/error/results
  screens, Settings or the launch animation. Audio-first dialogue screens
  do not request ambience in this implementation.
- Pause immediately on app inactive/background or screen blur. Resume from
  the same position on the next eligible activity; loop at track end.
  A fresh process starts from the beginning. There is no inactivity timer:
  reading silently without touching the screen still counts as reading.

## Implementation

1. **Asset and preferences:** copy the MP3 to `apps/mobile/assets/audio`.
   Use `audio.ambient` in the existing settings table and hydrate it at
   startup. Serialize preference writes to preserve rapid changes.
2. **One player owner:** mount `AmbientAudioHost` in the root layout. Create
   the player lazily only when needed and retain it through temporary
   pauses. The controller invalidates asynchronous starts on newer state,
   navigation, backgrounding and teardown, so a late initialization cannot
   start music after leaving the screen.
3. **Activity integration:** focused activity registrations in the reader
   and `SessionShell` determine eligibility. Focused quiet registrations
   suppress listening and pronunciation. The host also observes speech
   state and app lifecycle synchronously.
4. **Speech compatibility:** track expo-speech completion, cancellation and
   error separately from Piper's native speaking events. Generation checks
   prevent stale system callbacks from clearing a newer utterance's state.
5. **Settings:** follow the existing token colors, switch rows and radio
   choices. Save on/off and level across restarts. Settings itself does
   not preview playback; return to reading or a game to hear the change.
6. **Verification:** controller tests cover lazy creation, reuse, volume,
   zero-volume pause, pending-start cancellation, disposal and setup errors.
   Preference tests cover defaults, corruption and bounds. Run TypeScript,
   lint and Android Metro export, then the device matrix below.

The player does not register lock-screen controls or change the global
background-playback flag. Reader narration retains its existing background
policy. `keepAudioSessionActive` avoids the ambience player deactivating a
shared iOS audio session when it pauses. See the [Expo 57 audio API](https://docs.expo.dev/versions/v57.0.0/sdk/audio/).

## Tradeoffs

The unchanged MP3 adds approximately 32 MB to the bundled assets. If release
size becomes a concern, make a lower-bitrate derivative in a separate
follow-up and compare it audibly with the original. Native loop behavior is
used; a mathematically seamless edit or crossfade is not assumed. Pauses
are immediate to protect speech and background transitions; this version
does not add fade ramps. Audio-mode/setup failures are logged without
blocking study; leaving/re-entering or changing the preference retries.

## Device acceptance before release

Automated verification completed: mobile TypeScript check, 73 test files /
652 tests passing, and Android Metro/Hermes export with the 32 MB MP3
included. SHA-256 confirms the bundled file matches the supplied original.
The signed Android release APK also built successfully and passed signature
verification (approximately 120 MB). Output:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
The Galaxy S25 (`R3GYA00L1XX`, SM-S931U1) was authorized and tested on
2026-09-06. Its installed app used the standard development certificate, so
the release-signed update was correctly rejected by Android. A separate copy
of the feature APK was signed with the verified matching local development
key and installed successfully with `adb install -r`, preserving app data.
Installed feature version: 1.2.0 / versionCode 4. The narration-mixing follow-up
was built with the existing development-signing fallback for this device;
the current local APK output is development-signed. Use the release script
to regenerate a release-key-signed APK. See `ambient-study-music-device-check.md`
for the initial and follow-up results.
The remaining checks below are a broader release acceptance matrix.

- Cold-launch directly into a reader: no music during the intro/loading;
  quiet playback after the text is visible. Check the whole loop boundary.
- Leave a reader for the library or Settings, and return. Confirm one track
  resumes, with no duplicate playback or unexpected restart.
- Start each supported game and a mixed daily session. Confirm silence
  on loading, empty queues, errors, completion and quitting.
- Play, pause and finish story narration: both tracks play together, and
  music continues at its selected level without restarting. Test word-segment
  lookup and both installed Piper and system TTS separately: music pauses
  for these readouts. Test fast repeated speech and cancellation.
- Test a listening item in a daily session and a pronunciation recording.
  Confirm no music is heard or captured, and it resumes on later cards.
- Home, app switcher, notification shade, screen lock, calls, wired/Bluetooth
  headphone disconnection/reconnection: verify native focus behavior and
  no unintended background ambience. Confirm explicit background narration
  and its notification still work.
- Toggle music and all levels; restart the app and verify persistence.
  Test offline/airplane mode, small screens and large accessibility text.
- Use a release/dev build on Android (and iOS if supported). Automated
  JavaScript tests cannot establish subjective volume or native audio-focus
  behavior. No release or deployment is part of this change.
