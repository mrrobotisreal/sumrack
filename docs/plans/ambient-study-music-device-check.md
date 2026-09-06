# Galaxy S25 device validation

Date: 2026-09-06. Device: SM-S931U1, ADB `R3GYA00L1XX`.
Branch: `feature/ambient-study-music`. Installed app: 1.2.0 / versionCode 4.

## Installation

USB debugging was initially unauthorized; reconnecting ADB and accepting
on the phone established the connection. The installed 1.1.0 / versionCode 3
app used the standard Android development key. Its SHA-256 certificate
matched the local generated Android debug keystore. The release-signed APK
could not update that app, as expected. A separate APK copy was signed with
the matching development key and installed with `adb install -r`. No app
uninstall, data clear, or signing configuration change was performed. The
original release APK remains release-signed.

## Observed results

| Check | Result |
| --- | --- |
| Launch / Today | No Sumrak audio player playing before entering a study activity. |
| Existing library story | Soundtrack starts: one stereo 44.1 kHz Android AudioTrack. |
| Narration play | Narration's mono 48 kHz track starts; soundtrack pauses. |
| Narration pause | Narration pauses; the same soundtrack player resumes. |
| App sent Home | Soundtrack pauses while app is backgrounded. |
| Return to app | The same soundtrack player resumes; no duplicate player. |
| Open Settings over reader | Soundtrack pauses. |
| Settings layout | Toggle and all three music levels visible and readable on the S25. |
| Review session | Music plays during the first multiple-choice item. |
| Mixed daily session | Music plays during the first multiple-choice item. |
| Listening exercise | Music remains paused while the exercise is visible. |
| Pronunciation exercise | Music remains paused while the exercise is visible; microphone was not activated. |
| Preferences across process restart | Disabled setting and Very quiet level both survive force-stop/relaunch. |
| Preference restoration | Enabled + Quiet restored and verified in the accessibility tree. |
| Return to library | Music pauses outside active reading/gameplay. |
| App error logs | No entries from the tested processes under ReactNativeJS:E, AndroidRuntime:E or ExpoAudio:E. |

Playback observations use Android's `AudioPlaybackConfiguration` state,
player identities and audio formats, together with the actual screen's
accessibility tree. They verify native playback transitions, not subjective
sound quality. No review answers were submitted or cards graded. Opening
study screens can update normal activity/session telemetry and reading time.

The initial preference-change command was rejected by automatic approval
review because it omitted restoration. It did not run. The revised test
verified the original values first and used a `finally` cleanup to restore
them; that test was approved and completed successfully.

## Remaining acceptance checks

Subjective loudness, the full 13-minute loop boundary, real calls and
headphone/Bluetooth interruptions still need listening/hardware checks.
Actual microphone capture was deliberately not performed. The sampled
review and daily items were multiple choice; a flashcard face and every
other game variant were not individually exercised on this device. They
share the tested SessionShell integration. System-TTS callback races and
controller lifecycle behavior are covered by the automated suite; both
speech engines were not independently exercised in this device pass.

The feature build remains installed, music enabled at Quiet, and the phone
was returned to Библиотека. Nothing has been merged or pushed.
