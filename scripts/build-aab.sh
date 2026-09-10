#!/usr/bin/env bash
# Turns this checkout into the Android App Bundle Google Play accepts.
#
# The sibling of scripts/build-apk.sh, and deliberately a second script rather
# than a flag: the APK is what someone sideloads onto a test device, the AAB is
# what gets uploaded to Play and can never be re-uploaded under the same version
# code. They are not the same artifact and should not be one command away from
# each other by accident.
#
# Runs inside the image built from ./Dockerfile:
#
#   BUILD_SCRIPT=scripts/build-aab.sh scripts/build-apk-in-docker.sh <image>
#
# Requires an upload key (see docs/PLAY_STORE.md); android/app/build.gradle
# fails the bundle rather than signing it with the committed debug keystore.
#
# Anything passed here goes on to Gradle.
set -euo pipefail

cd "$(dirname "$0")/.."

# `ci`, not `install`: a release must be built from the lockfile, never from
# whatever a resolver picks on the day.
npm ci --no-audit --no-fund

cd android
./gradlew bundleRelease --no-daemon "$@"
