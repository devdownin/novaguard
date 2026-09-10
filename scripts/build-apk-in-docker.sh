#!/usr/bin/env bash
# Runs a build script inside the toolchain image from ./Dockerfile.
#
# One definition of the invocation, called identically by android-image.yml on a
# pull request and by build-apk on a release. Two copies that drift is how a
# release path stops resembling the one that was tested.
#
#   docker build -t novaguard-android .
#   scripts/build-apk-in-docker.sh novaguard-android
#
# APK_CACHE_DIR relocates the Gradle and npm caches; CI points it at a directory
# it restores between runs so the container starts cold but the downloads do not.
#
# BUILD_SCRIPT picks what runs inside — scripts/build-apk.sh by default, or
# scripts/build-aab.sh for the bundle Play takes. One `docker run` invocation
# either way: the container plumbing (user, caches, mounts) has exactly one
# definition, and the two artifacts differ only by the Gradle task.
set -euo pipefail

IMAGE="${1:?usage: [BUILD_SCRIPT=scripts/build-aab.sh] build-apk-in-docker.sh <image-ref> [gradle args...]}"
shift
BUILD_SCRIPT="${BUILD_SCRIPT:-scripts/build-apk.sh}"

# The upload keystore, when there is one, is mounted read-only at /signing —
# from outside the checkout, so nothing can sweep it up into an artifact, and
# read-only so a build cannot touch it. NOVAGUARD_UPLOADSTOREFILE then names a
# path inside the container (/signing/upload.jks), not one on the host.
SIGNING_MOUNT=()
if [ -n "${SIGNING_DIR:-}" ]; then
  SIGNING_MOUNT=(-v "${SIGNING_DIR}:/signing:ro")
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${APK_CACHE_DIR:-${ROOT}/.ci-cache}"
mkdir -p "${CACHE}/gradle" "${CACHE}/npm"

# Running as the invoking user keeps Gradle from leaving root-owned build
# directories behind — on CI that breaks the later artifact upload, and on a
# developer's machine it leaves a checkout they cannot clean without sudo.
# HOME is redirected because that user has none inside the image.
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "${ROOT}":/app -w /app \
  -v "${CACHE}/gradle":/gradle-home \
  -v "${CACHE}/npm":/npm-cache \
  -e GRADLE_USER_HOME=/gradle-home \
  -e npm_config_cache=/npm-cache \
  -e HOME=/tmp \
  "${SIGNING_MOUNT[@]}" \
  -e NOVAGUARD_UPLOADSTOREFILE \
  -e NOVAGUARD_UPLOADSTOREPASSWORD \
  -e NOVAGUARD_UPLOADKEYALIAS \
  -e NOVAGUARD_UPLOADKEYPASSWORD \
  "${IMAGE}" \
  "${BUILD_SCRIPT}" "$@"
