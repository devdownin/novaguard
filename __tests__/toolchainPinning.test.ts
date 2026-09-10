/**
 * The build image must carry exactly what the build asks for.
 *
 * Three places name the Android toolchain: `android/build.gradle` decides what
 * the build wants, the root `Dockerfile` decides what the image installs, and
 * `android-image.yml` asserts what it found there before publishing the image
 * every release is then built from. Nothing tied them together, so they could
 * drift silently — and the drift does not degrade gracefully. A component the
 * build wants and the SDK does not have makes AGP try to download it, into a
 * directory it has no permission to write (`scripts/build-apk-in-docker.sh`
 * runs as the invoking user, so `/opt/android-sdk` is read-only):
 *
 *     Failed to install: ndk;27.0.12077973
 *     The SDK directory is not writable (/opt/android-sdk)
 *
 * It also does not fail all at once: agreeing on the NDK only got the build as
 * far as `cmake;3.22.1`. Every component the image installs is checked here,
 * so the next one is not found one CI run at a time.
 *
 * That failure surfaces only in a real Gradle run, which no pull request does.
 * Comparing three strings does, in a millisecond. To watch it fail, bump the
 * NDK in `android/build.gradle` and leave the Dockerfile alone.
 *
 * @format
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

/** The single capture group of `pattern`, or a readable failure. */
function extract(file: string, pattern: RegExp): string {
  const match = read(file).match(pattern);
  if (!match) throw new Error(`${file} no longer matches ${pattern}`);
  return match[1];
}

const GRADLE = 'android/build.gradle';
const DOCKERFILE = 'Dockerfile';
const WORKFLOW = '.github/workflows/android-image.yml';

describe('the Android toolchain is pinned in one place at a time', () => {
  it('installs the NDK the build asks for', () => {
    const wanted = extract(GRADLE, /ndkVersion\s*=\s*"([^"]+)"/);

    expect(extract(DOCKERFILE, /ARG ANDROID_NDK=(\S+)/)).toBe(wanted);
    expect(read(WORKFLOW)).toContain(`$ANDROID_HOME/ndk/${wanted}`);
  });

  it('installs the build-tools the build asks for', () => {
    const wanted = extract(GRADLE, /buildToolsVersion\s*=\s*"([^"]+)"/);

    expect(extract(DOCKERFILE, /ARG ANDROID_BUILD_TOOLS=(\S+)/)).toBe(wanted);
    expect(read(WORKFLOW)).toContain(`$ANDROID_HOME/build-tools/${wanted}`);
  });

  it('installs the platform the build compiles against', () => {
    const wanted = extract(GRADLE, /compileSdkVersion\s*=\s*(\d+)/);

    expect(extract(DOCKERFILE, /ARG ANDROID_PLATFORM=(\S+)/)).toBe(wanted);
    expect(read(WORKFLOW)).toContain(`$ANDROID_HOME/platforms/android-${wanted}`);
  });

  it('installs the CMake the build asks for', () => {
    // This one has no natural Gradle-side pin — no native module sets a CMake
    // version, so they all inherit AGP's default — which is precisely why the
    // root script forces one, and why it belongs here with the rest.
    const wanted = extract(GRADLE, /cmakeVersion\s*=\s*"([^"]+)"/);

    expect(extract(DOCKERFILE, /ARG ANDROID_CMAKE=(\S+)/)).toBe(wanted);
    expect(read(WORKFLOW)).toContain(`$ANDROID_HOME/cmake/${wanted}`);
  });

  it('holds every Android module to that toolchain, not just ours', () => {
    // Libraries that pin their own versions — or, like
    // react-native-worklets-core, pin none and let AGP choose — would each ask
    // the read-only SDK for something it does not have. The root script
    // overrides all three values on every Android subproject; without that,
    // pinning the image correctly is not enough.
    const gradle = read(GRADLE);
    expect(gradle).toMatch(/subprojects\s*\{/);
    for (const property of [
      'compileSdk',
      'buildToolsVersion',
      'ndkVersion',
      // Dropping this one gets you a build that agrees on the NDK and then
      // fails at `configureCMake…` instead — one component further along.
      'externalNativeBuild.cmake.version',
    ]) {
      expect(gradle).toContain(`androidExtension.${property} = rootProject.ext.`);
    }
  });
});
