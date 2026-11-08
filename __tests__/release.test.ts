/**
 * What has to agree before a release, and the one dependency whose upgrade
 * means deleting code.
 *
 * @format
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { resolve } from 'path';
import packageJson from '../package.json';
import packageLock from '../package-lock.json';
import { APP_VERSION } from '../src/constants/app';

const ROOT = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('the version', () => {
  it('is the same in the app, package.json and the lockfile', () => {
    // `versionName` is read from package.json (`android/app/build.gradle`);
    // `APP_VERSION` is what Setup → À propos shows. Two copies that drift tell
    // a reporter one version and ship another.
    expect(APP_VERSION).toBe(packageJson.version);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[''].version).toBe(packageJson.version);
  });

  it('has a section in the changelog and a link at its foot', () => {
    // Plain string comparisons rather than a pattern built from the version:
    // a version is data, and escaping it by hand is how a pattern goes wrong.
    const lines = read('CHANGELOG.md').split('\n');
    const prefix = `## [${packageJson.version}] - `;
    const heading = lines.find(line => line.startsWith(prefix));
    expect(heading).toBeDefined();
    expect(heading!.slice(prefix.length)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lines.some(line => line.startsWith(`[${packageJson.version}]: https://github.com/`))).toBe(true);
  });

  it('points "Non publié" at the commits after it', () => {
    expect(read('CHANGELOG.md')).toContain(`/compare/v${packageJson.version}...HEAD`);
  });
});

/**
 * `useCameraDeviceRecovery` (and `refreshCameraDevices` in
 * `SurveillanceServiceModule.kt`) work around VisionCamera 4.7 reading the
 * camera list before CameraX has finished starting and never sending it again.
 * That is a bug in one release line. This fails on the first release of
 * another, so the upgrade is where someone looks at whether the library now
 * sends the list itself — and deletes the workaround if so, the hook, the
 * native method, the spec entry and the CLAUDE.md paragraph with it.
 *
 * To watch it fail, change `VERIFIED_LINE`.
 */
describe('the camera-list workaround', () => {
  const VERIFIED_LINE = '4.7';

  it('is checked again whenever VisionCamera leaves the release line it was written for', () => {
    const installed: string = JSON.parse(read('node_modules/react-native-vision-camera/package.json')).version;
    const line = installed.split('.').slice(0, 2).join('.');
    if (line !== VERIFIED_LINE) {
      throw new Error(
        `react-native-vision-camera is ${installed}; the camera-list workaround was written for ${VERIFIED_LINE}.x. ` +
        'Check whether CameraDevicesManager now re-emits the device list once CameraX is ready ' +
        '(a cold start with the camera permission granted shows the image without the retry). ' +
        'If it does, remove useCameraDeviceRecovery, refreshCameraDevices (Kotlin, spec, wrapper, mock) and the ' +
        'CLAUDE.md paragraph, and delete this test; if not, set VERIFIED_LINE to the new line.',
      );
    }
  });

  it('is still there to be removed — this test goes with it', () => {
    expect(() => read('src/camera/useCameraDeviceRecovery.ts')).not.toThrow();
  });
});
