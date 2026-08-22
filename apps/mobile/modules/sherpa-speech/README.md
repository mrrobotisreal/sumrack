# sherpa-speech — local Expo module (T11 + T12)

On-device Russian speech for Сумрак, wrapping [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx):

- **TTS (T11)**: Piper VITS Russian voices (Руслан / Ирина / Денис / Дмитрий), streamed to an `AudioTrack` as synthesis chunks arrive.
- **ASR (T12)**: offline Zipformer transducer (Russian, int8) + mic capture (AudioRecord → 16 kHz mono PCM16 WAV — the exact input format the recognizer wants, since Android's MediaRecorder can't produce WAV). TTS and ASR run on separate single-thread executors so neither queues behind the other.

The JS surface is `index.ts` (typed `requireNativeModule` binding). App-level logic — voice catalog, downloads, engine routing, `expo-speech` fallback — lives in `apps/mobile/src/features/tts/`, not here. This module stays a thin native wrapper.

## How the integration survives `expo prebuild` (design §11 risk area)

`android/` is **generated and gitignored**; nothing in it can be relied on. Everything the module needs lives in this directory, which prebuild never touches:

1. **Autolinking**: Expo SDK 57 automatically discovers local modules under `<app root>/modules/*/expo-module.config.json`. No config-plugin, no settings.gradle edit, no MainApplication registration. Verify with:
   `npx expo-modules-autolinking resolve -p android` (should list `sherpa-speech`).
2. **The sherpa-onnx dependency**: there is no official Maven Central artifact. `android/build.gradle` registers an **ivy repository** pointing at the GitHub release assets and depends on `com.k2fsa.sherpa.onnx:sherpa-onnx:1.13.6@aar` (prebuilt AAR: JNI libs for all 4 ABIs + the Kotlin API classes). The repository is registered via `rootProject.allprojects { repositories { … } }` **from the module's own build.gradle** — the app project resolves the module's transitive deps against the app's repositories, and the app's build.gradle is generated, so the registration must ride along with the module.
3. **Archive extraction**: Piper voices ship as `.tar.bz2`; Android has no bzip2, so the module depends on `org.apache.commons:commons-compress` (Maven Central).
4. The expo-module-gradle-plugin requires `defaultConfig.versionCode/versionName` in the module's `android` block — omitting them fails the build at configuration time.

Reproduced from scratch this session (2026-08-21): `npx expo prebuild --platform android --clean --no-install` → `./gradlew :app:assembleDebug` → installed and ran on the S24 Ultra with the module working. First build downloads the ~49 MB AAR once into the Gradle cache.

**JAVA_HOME note (T04)**: build with `JAVA_HOME=$(/usr/libexec/java_home -v 17)`.

## Native API (Kotlin: `SherpaSpeechModule`)

| Function                                             | Notes                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadVoice(voiceId, modelPath, tokensPath, dataDir)` | Loads a Piper voice (~0.7–0.9 s on S24 Ultra) on a dedicated TTS thread; same-id reload is a no-op. One voice loaded at a time.                                      |
| `speak(text, rate)`                                  | `generateWithCallback` → streaming `AudioTrack` (float PCM). Resolves at **first audible chunk** with `firstAudioMs`. Completion via `onSpeakingStateChanged` event. |
| `stop()`                                             | Immediate halt (utterance-seq bump + pause/flush; chunked writes prevent a blocked `write` deadlock).                                                                |
| `synthesizeToFile(text, rate, outPath)`              | Full render → WAV via sherpa's native writer. Returns duration + pure-synthesis ms. For caching / T14 / T15 readback.                                                |
| `loadAsr(asrId, encoder, decoder, joiner, tokens)`   | Loads the offline Zipformer transducer (greedy_search — the decoding mode that emits per-token timestamps). Same-id reload is a no-op.                               |
| `unloadAsr()` / `getLoadedAsrId()`                   | Recognizer lifecycle, mirrors the voice API.                                                                                                                         |
| `transcribeFile(wavPath)`                            | Mono/stereo PCM16 WAV → `{text, words[{word,startMs,endMs}], decodeMs, audioMs}`. Words aggregated from BPE tokens (leading `▁`/space starts a word).                |
| `startRecording(outPath)`                            | Mic → 16 kHz mono PCM16 WAV. Requires RECORD_AUDIO already granted (JS owns the flow). Emits `onRecordingLevel` (~8/s RMS) for the level ring.                       |
| `stopRecording()` / `cancelRecording()`              | Finalize the WAV header and return `{path, durationMs}` / abort and delete. Both idempotent-safe on teardown.                                                        |
| `sha256File(path)`                                   | Streaming hash — 67 MB archives never enter JS memory.                                                                                                               |
| `extractTarBz2(archivePath, destDir)`                | commons-compress, path-traversal-safe, returns top-level dir + bytes written.                                                                                        |
| `dirSize(path)`                                      | Recursive bytes, for Settings storage accounting.                                                                                                                    |

Measured on the S24 Ultra (medium fp32 voices, rate 1×): sentence first-audio 302–374 ms, single word ~60 ms, voice cold load 675–835 ms — comfortably inside the design §6 "< ~1 s" budget.

## Voice models

Not bundled in the APK (design §6). Downloaded on demand by `src/features/tts/manager.ts` from the official k2-fsa `tts-models` release assets, sha256-pinned in `src/features/tts/catalog.ts`, verified before extraction, installed under `documentDirectory/tts-voices/<dirName>/`. Each voice is self-contained (model + tokens + its own `espeak-ng-data`), ~77 MB installed.

## ASR model (T12)

Same pattern via `src/features/pronunciation/asr-manager.ts`: `sherpa-onnx-zipformer-ru-int8-2025-04-20` from the k2-fsa `asr-models` release assets (60.2 MB archive), sha256-pinned in `asr-catalog.ts`, installed under `documentDirectory/asr-models/<dirName>/`. Chosen as the only Russian model inside the design §6 40–60 MB window (GigaAM is better but 163+ MB). Host-verified before integration: accurate transcription of the bundled Russian test WAVs with per-token timestamps.

## Upgrading sherpa-onnx

Bump the version in `android/build.gradle` (dependency + nothing else — the ivy pattern derives the URL). Check the [release notes](https://github.com/k2-fsa/sherpa-onnx/releases) for Kotlin API changes; the API used here (`OfflineTts`, `OfflineTtsVitsModelConfig`, `generateWithCallback`) has been stable.
