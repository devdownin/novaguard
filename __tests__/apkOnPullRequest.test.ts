/**
 * A pull request that can break the native build has to build one.
 *
 * `check` compiles no Android resource beyond asserting each XML is
 * well-formed, and `toolchainPinning` only compares version strings between
 * three files. Neither runs Gradle. A manifest error, a native module demanding
 * a different NDK, a dependency whose autolinked code does not compile — all of
 * it reached `main` untouched, which is the class of failure that once kept the
 * APK broken across eleven merges.
 *
 * `ci.yml` now decides per pull request, from the files it changed. That
 * decision is a shell one-liner in a workflow, so nothing but a real Actions
 * run would ever exercise it — and a real Actions run of the thing it gates
 * costs minutes and only happens after a merge. Applying the same expression
 * here costs a millisecond.
 *
 * To watch it fail, drop `android/` from the filter in `ci.yml`.
 *
 * @format
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

const CI = '.github/workflows/ci.yml';
const IMAGE = '.github/workflows/android-image.yml';

/**
 * The very expression the workflow runs, lifted out of it.
 *
 * Rebuilt from the file rather than restated here: a copy would keep passing
 * after someone edited the workflow, which is the one thing this must not do.
 */
function pathFilter(): RegExp {
  const match = read(CI).match(/grep -qE '([^']+)'/);
  if (!match) throw new Error(`${CI} no longer runs a grep -qE path filter`);
  return new RegExp(match[1]);
}

/** The paths `android-image.yml` already builds an APK for on a pull request. */
function imageWorkflowPaths(): string[] {
  const block = read(IMAGE).match(/pull_request:\s*\n\s*paths:\n((?:\s*- .*\n)+)/);
  if (!block) throw new Error(`${IMAGE} no longer path-filters its pull_request trigger`);
  return block[1].split('\n').map(line => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

describe('deciding whether a pull request needs an APK', () => {
  const matches = (path: string) => pathFilter().test(path);

  it('builds one for anything Gradle actually reads', () => {
    expect(matches('android/app/src/main/AndroidManifest.xml')).toBe(true);
    expect(matches('android/build.gradle')).toBe(true);
    expect(matches('android/app/src/main/java/com/novaguard/surveillance/Service.kt')).toBe(true);
  });

  it('builds one when a dependency changes, since its native code is autolinked', () => {
    expect(matches('package.json')).toBe(true);
    expect(matches('package-lock.json')).toBe(true);
  });

  it('builds one for a TurboModule spec, which codegen turns into native sources', () => {
    // JavaScript by extension, native by consequence — the reason the filter
    // cannot simply be "android/".
    expect(matches('src/specs/NativeSurveillanceService.ts')).toBe(true);
  });

  it('builds one when the workflow that builds it changes', () => {
    expect(matches('.github/workflows/ci.yml')).toBe(true);
  });

  it('leaves an ordinary JavaScript pull request alone', () => {
    // The whole reason this is a filter and not an unconditional job: a native
    // build is minutes, and most pull requests here cannot affect it.
    expect(matches('src/state/AppStateContext.tsx')).toBe(false);
    expect(matches('__tests__/library.test.ts')).toBe(false);
    expect(matches('CHANGELOG.md')).toBe(false);
  });

  it('is anchored, so a lookalike path elsewhere does not trigger it', () => {
    expect(matches('src/vendor/package.json')).toBe(false);
    expect(matches('docs/android-notes.md')).toBe(false);
  });
});

describe('the two APK builds do not overlap', () => {
  it('leaves every path android-image.yml already covers to it', () => {
    const filter = pathFilter();
    const covered = imageWorkflowPaths();

    // Both workflows build an APK. Listing a path in both downloads several
    // gigabytes of Android SDK twice for one pull request — android-image.yml
    // rebuilds the image from scratch, and ci.yml would miss the published tag
    // for a Dockerfile that does not exist yet and build it again.
    expect(covered.length).toBeGreaterThan(0);
    for (const path of covered) {
      expect({ path, alsoInCi: filter.test(path) }).toEqual({ path, alsoInCi: false });
    }
  });
});

describe('the job is actually wired to the filter', () => {
  const ci = read(CI);

  it('gates the APK on the decision, so a pull request can reach it at all', () => {
    // Without this clause the filter computes an answer nothing reads, which is
    // exactly the shape of an inert setting this repository has shipped before.
    expect(ci).toContain("github.event_name == 'pull_request' && needs.changes.outputs.android == 'true'");
  });

  it('waits for the decision before building', () => {
    expect(ci).toMatch(/build-apk:[\s\S]*?needs:\s*\[check,\s*changes\]/);
  });

  it('keeps building after a merge and on a version tag', () => {
    // The paths that already worked; a filter is no reason to lose them.
    expect(ci).toContain("github.event_name == 'workflow_dispatch'");
    expect(ci).toContain("github.ref == 'refs/heads/main'");
    expect(ci).toContain("startsWith(github.ref, 'refs/tags/')");
  });
});
