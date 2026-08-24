#!/usr/bin/env bash
# T22 release build script — repeatable signed release APK for sideloading.
#
# Usage:
#   export SUMRAK_KEYSTORE_PATH=~/keystores/sumrak-release.keystore
#   export SUMRAK_KEYSTORE_PASSWORD=...   # never stored in the repo
#   export SUMRAK_KEY_ALIAS=sumrak-release
#   export SUMRAK_KEY_PASSWORD=...
#   ./scripts/release-android.sh
#
# Output: apps/mobile/android/app/build/outputs/apk/release/app-release.apk
# Docs: README "Release builds" + docs/RUNBOOK.md at the repo root.
set -euo pipefail

cd "$(dirname "$0")/.."   # apps/mobile

# ---- Signing env -----------------------------------------------------------
# Credentials come from the environment. If not already exported, source the
# canonical env file (outside every repo, chmod 600, never committed):
#   ~/.sumrak/release.env
# containing the four SUMRAK_* exports — see README "Release builds".
if [ -z "${SUMRAK_KEYSTORE_PATH:-}" ] && [ -f "$HOME/.sumrak/release.env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.sumrak/release.env"
fi

# ---- Preconditions ---------------------------------------------------------
for v in SUMRAK_KEYSTORE_PATH SUMRAK_KEYSTORE_PASSWORD SUMRAK_KEY_ALIAS SUMRAK_KEY_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "ERROR: $v is not set. A release build must be signed with the release keystore." >&2
    echo "See README 'Release builds' for keystore generation and env setup." >&2
    exit 1
  fi
done
# Expand ~ if present and verify the keystore exists (value is a path, never printed beyond this).
KEYSTORE_PATH="${SUMRAK_KEYSTORE_PATH/#\~/$HOME}"
if [ ! -f "$KEYSTORE_PATH" ]; then
  echo "ERROR: keystore not found at SUMRAK_KEYSTORE_PATH ($KEYSTORE_PATH)." >&2
  exit 1
fi
export SUMRAK_KEYSTORE_PATH="$KEYSTORE_PATH"

# JDK 17 (the shell's JAVA_HOME is often stale — T04 note).
if [ -x /usr/libexec/java_home ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  export JAVA_HOME
fi

VERSION_NAME=$(node -p "require('./app.json').expo.version")
VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")
echo "==> Building Сумрак release v${VERSION_NAME} (versionCode ${VERSION_CODE})"

# ---- 1. Prebuild (regenerates android/ with the signing plugin applied) ----
echo "==> expo prebuild"
npx expo prebuild --platform android --no-install

# ---- 2. Signed release build (direct gradlew: `expo run:android` breaks on
#         the sherpa AAR ivy repo with --configure-on-demand, T19 note) -----
echo "==> gradlew :app:assembleRelease"
(cd android && ./gradlew :app:assembleRelease)

APK=android/app/build/outputs/apk/release/app-release.apk
if [ ! -f "$APK" ]; then
  echo "ERROR: expected APK not found at $APK" >&2
  exit 1
fi

# ---- 3. Verify the signature is the release key (not debug) ---------------
BUILD_TOOLS_DIR=$(ls -d "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/* 2>/dev/null | sort -V | tail -1)
if [ -n "$BUILD_TOOLS_DIR" ] && [ -x "$BUILD_TOOLS_DIR/apksigner" ]; then
  echo "==> apksigner verify"
  "$BUILD_TOOLS_DIR/apksigner" verify --print-certs "$APK" | head -3
  if "$BUILD_TOOLS_DIR/apksigner" verify --print-certs "$APK" | grep -qi "Android Debug"; then
    echo "ERROR: APK is debug-signed — the release signingConfig did not apply." >&2
    exit 1
  fi
else
  echo "WARN: apksigner not found; skipping signature verification." >&2
fi

SIZE=$(du -h "$APK" | cut -f1)
echo "==> Done: $APK (${SIZE})"
echo "    Install: adb install -r $APK"
