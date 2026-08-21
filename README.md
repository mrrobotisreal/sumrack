# Сумрак (Sumrak)

Personal, single-user, offline-first Android app for mastering Russian (~A1 → C1+). Never store-published; built for one device (Samsung Galaxy S24 Ultra). Design docs live at the workspace root: `../docs/SUMRAK_DESIGN.md`, `../docs/SUMRAK_ROADMAP.md`, `../docs/SUMRAK_TICKETS.md`.

## Monorepo layout

```
Sumrak/
  apps/mobile/          # Expo app (expo-router, NativeWind, custom dev build)
  packages/schema/      # Zod schemas for content packs (T02)
  packages/pipeline/    # Authoring pipeline CLI (T08/T09)
```

The Go `syncd` backup service lives in the separate `SumrakAPI` repo; content packs live in the private `sumrak-content` repo (ADR-0015).

## Prerequisites

- Node 24+, pnpm 11 (`corepack enable pnpm`)
- JDK 17
- Android SDK (`ANDROID_HOME` set), platform-tools on PATH for `adb`

## Install

```sh
pnpm install
```

## Dev-build workflow (no Expo Go — ever)

This project uses a **custom dev client** (`expo-dev-client`) because a local native Expo module (`sherpa-onnx` speech, T11) will be part of the app. Expo Go cannot load custom native code, so it is never used here.

```sh
cd apps/mobile

# 1. Generate the android/ project (idempotent; android/ is gitignored)
npx expo prebuild --platform android

# 2. Build, install, and launch on the connected device/emulator
npx expo run:android

# Subsequent JS-only iterations: keep the installed dev client, just start Metro
npx expo start
```

### Running on the S24 Ultra (physical device)

1. Enable **Developer options** → **USB debugging** on the phone.
2. Plug in via USB and accept the RSA fingerprint prompt; `adb devices` should list the phone as `device`.
3. `npx expo run:android` builds and installs the dev client, then starts Metro.
4. After the dev client is installed once, `npx expo start` is enough — open the Сумрак dev client on the phone; it connects to Metro over USB or the same Wi-Fi network (the dev client's launcher screen lets you enter the dev server URL manually if auto-discovery fails).

### Release APK (sideload)

```sh
cd apps/mobile/android && ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk, install with adb install
```

(Signing config and a release script land in T22.)

## Quality gates

```sh
pnpm typecheck     # tsc --noEmit, strict, all workspace packages
pnpm lint          # eslint (expo config)
pnpm format:check  # prettier
```

## Conventions (enforced from T01 onward)

- **No hardcoded colors** — NativeWind token classes only (`bg-bg`, `text-text`, `text-accent`…). Token values live in `apps/mobile/src/global.css`, mirrored for native chrome in `src/theme/colors.ts`.
- Feature code goes under `apps/mobile/src/features/<name>`; repositories own DB access (from T03); React Query for async reads.
- Russian text is UTF-8 NFC, ё preserved.
- Stable string ids, never renumbered.
- Analytics: user actions go through `src/services/analytics.ts` `track()` (SQLite-backed from T03).
