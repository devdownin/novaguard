#!/usr/bin/env bash
# Turns this checkout into a release APK. The single definition of that, so the
# command CI verifies on a pull request and the command that cuts a release are
# the same one — a release path nobody exercises is how the APK build stayed
# broken for eleven merges without anyone noticing.
#
# Runs inside the image built from ./Dockerfile, which carries the Android SDK:
#
#   docker run --rm -v "$PWD":/app -w /app novaguard-android scripts/build-apk.sh
#
# Anything passed here goes on to Gradle, so `--scan` or `-Pfoo=bar` work.
set -euo pipefail

cd "$(dirname "$0")/.."

# `ci`, not `install`: a release must be built from the lockfile, never from
# whatever a resolver picks on the day.
npm ci --no-audit --no-fund

cd android
# No daemon: it would outlive the container for nothing, and a reused daemon is
# a way for one build to inherit state from another.
./gradlew assembleRelease --no-daemon "$@"
