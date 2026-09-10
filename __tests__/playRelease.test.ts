/**
 * What has to hold before a build can be uploaded to Google Play.
 *
 * None of it is reachable by tsc, eslint or a rendered component: it lives in
 * a Gradle script, a manifest and a workflow. It is also the class of mistake
 * that is only discovered in the Play Console — where a rejected upload costs a
 * version code that can never be reused, and where an over-claimed permission
 * costs a review round rather than an error message.
 *
 * The two facts guarded here are the two that were actually wrong: every
 * release was signed with the debug keystore committed in this repository (Play
 * rejects it outright, and every checkout has that private key), and the
 * version existed as a literal in `build.gradle` next to another one in
 * package.json.
 *
 * @format
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/**
 * Comments stripped, because these assertions are about what Gradle executes.
 * The first version of the closure check below was failing on the comment that
 * explains the closure — prose naming the mistake read as the mistake.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const appGradle = stripComments(read('android/app/build.gradle'));
const manifest = read('android/app/src/main/AndroidManifest.xml');
const gradleProperties = read('android/gradle.properties');
const gitignore = read('.gitignore');
const privacyFr = read('PRIVACY.md');
const privacyEn = read('PRIVACY.en.md');

/** The body of one `buildTypes { … }` sub-block, braces balanced. */
function buildTypeBlock(name: string): string {
  const start = appGradle.indexOf(`\n        ${name} {`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = appGradle.indexOf('{', start); i < appGradle.length; i++) {
    if (appGradle[i] === '{') depth++;
    if (appGradle[i] === '}' && --depth === 0) return appGradle.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in the ${name} build type`);
}

describe('signing', () => {
  it('never hands the debug keystore to a release build unconditionally', () => {
    const release = buildTypeBlock('release');
    // The upload key when configured, the debug key when not — the ternary is
    // the whole point. A bare `signingConfig signingConfigs.debug` here is what
    // shipped, and it is what Play refuses.
    expect(release).toMatch(/signingConfig\s+hasUploadKey\s*\?/);
    expect(release).not.toMatch(/signingConfig\s+signingConfigs\.debug\s*$/m);
  });

  it('refuses to build a bundle without an upload key', () => {
    // An APK is for a test device and may keep the debug key. An AAB exists
    // only to be uploaded, so producing a debug-signed one is never useful —
    // it fails here instead, a second in, rather than in the Play Console.
    expect(appGradle).toMatch(/tasks\.matching[^\n]*bundle/);
    expect(appGradle).toContain('throw new GradleException(');
  });

  it('reads the credentials from a closure, not a script method', () => {
    // A `def uploadKey(String name) { … }` in a Gradle build script becomes a
    // member of the script class, which cannot see the script's own local
    // variables: it failed at configuration time on *every* build with
    // "Could not get unknown property 'keystoreProperties'". A closure captures
    // the enclosing scope. Nothing but a real Gradle run catches this — which
    // is what caught it, one CI cycle after the fact.
    expect(appGradle).toMatch(/def uploadKey\s*=\s*\{/);
    expect(appGradle).not.toMatch(/def uploadKey\s*\(/);
  });

  it('keeps upload credentials out of the repository', () => {
    // Read from properties or the environment, never a literal in the tree.
    expect(appGradle).toContain("rootProject.file(\"keystore.properties\")");
    expect(gitignore).toContain('android/keystore.properties');
    expect(gitignore).toContain('*.jks');
    // The one keystore that is committed, and the only one that may be.
    expect(gitignore).toContain('!debug.keystore');
  });
});

describe('version', () => {
  it('takes the marketing version from package.json rather than repeating it', () => {
    expect(appGradle).toContain('versionName packageJson.version');
    // A second literal is how a store listing and a changelog start disagreeing.
    expect(appGradle).not.toMatch(/versionName\s+["']/);
  });

  it("keeps Play's upload counter overridable and separate", () => {
    // Play refuses a version code it has already seen, so CI passes its own;
    // the file value is only the floor for a local build.
    expect(appGradle).toContain("project.findProperty('novaguardVersionCode')");
    expect(gradleProperties).toMatch(/^novaguardVersionCode=\d+$/m);
    expect(appGradle).not.toMatch(/versionCode\s+\d+/);
  });
});

describe('what the store listing promises', () => {
  /**
   * The Data safety form answers "no data collected", and the README says the
   * release APK does not even declare INTERNET. A dependency that adds it back
   * through manifest merging would make both statements false without a single
   * line of this repository changing — and that is a declaration to Google, not
   * a detail. This catches it in the one file we control; `:app` cannot be the
   * source of it either way.
   */
  it('asks for no network permission', () => {
    expect(manifest).not.toContain('android.permission.INTERNET');
  });

  it('declares exactly the permissions the app can justify', () => {
    const declared = [...manifest.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)]
      .map(m => m[1])
      .sort();
    // Each one is answerable in the Play Console: camera and microphone are the
    // capture itself, the foreground-service trio is what lets surveillance
    // survive the screen going off, notifications are the alerts.
    expect(declared).toEqual([
      'CAMERA',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_CAMERA',
      'FOREGROUND_SERVICE_MICROPHONE',
      'POST_NOTIFICATIONS',
      'RECORD_AUDIO',
      // The single tick that confirms surveillance started — a normal
      // permission, granted at install, with no privacy question to answer.
      'VIBRATE',
    ].sort());
  });

  it('backs every foreground-service type it claims with the matching permission', () => {
    // Since Android 14 a service must hold the permission for each type it
    // declares, and Play asks for a written justification per type. A type
    // claimed here with no permission above crashes on start, on a device.
    const types = manifest.match(/android:foregroundServiceType="([^"]+)"/)?.[1].split('|') ?? [];
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      expect(manifest).toContain(`android.permission.FOREGROUND_SERVICE_${type.toUpperCase()}`);
    }
  });
});

/**
 * The privacy policy is a Store listing field, in every language the listing is
 * published in — and the one document a reviewer reads end to end. Two copies
 * of it drift the moment one is edited alone, and a policy that no longer
 * describes the app is worse than no translation at all: it is a false
 * statement about what happens to someone's video.
 *
 * Structure and date, not prose: the two are translations, so the only things
 * that can be compared are how many sections, rows and bullets each has, and
 * whether they claim to have been updated on the same day.
 */
describe('the privacy policy, in both languages', () => {
  const sections = (doc: string) => doc.match(/^## .+$/gm) ?? [];
  const tableRows = (doc: string) => doc.match(/^\| /gm) ?? [];
  const bullets = (doc: string) => doc.match(/^- /gm) ?? [];
  const updated = (doc: string) => doc.match(/(\d+) (\w+) (2\d{3})/)?.slice(1);

  it('says the same thing in the same shape', () => {
    expect(sections(privacyEn)).toHaveLength(sections(privacyFr).length);
    expect(tableRows(privacyEn)).toHaveLength(tableRows(privacyFr).length);
    expect(bullets(privacyEn)).toHaveLength(bullets(privacyFr).length);
  });

  it('carries the same date on both', () => {
    // A section added to one and not the other shows up above; a section
    // *rewritten* in one only shows up here, and only if whoever rewrote it
    // moved the date — which is the habit this is meant to enforce.
    const [dayFr, , yearFr] = updated(privacyFr)!;
    const [dayEn, , yearEn] = updated(privacyEn)!;
    expect([dayEn, yearEn]).toEqual([dayFr, yearFr]);
  });

  it('points each version at the other', () => {
    expect(privacyFr).toContain('(PRIVACY.en.md)');
    expect(privacyEn).toContain('(PRIVACY.md)');
  });

  it('keeps the claim the Data safety form rests on', () => {
    // Both say the app cannot open a network connection. The manifest is
    // checked above; this is the sentence a reviewer reads.
    expect(privacyFr).toContain('INTERNET');
    expect(privacyEn).toContain('INTERNET');
  });
});
