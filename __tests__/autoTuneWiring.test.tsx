/**
 * The measurement has to reach the camera, and it has to stop at the user's
 * settings.
 *
 * `autoTune.ts` decides; this is the wiring that makes the decision worth
 * anything — the fold running on the frame path, the camera reading the tuned
 * values, and the two things that must never happen: the user's stored
 * settings being rewritten, and a verdict outliving the session it was
 * measured in.
 *
 * @format
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { resolve } from 'path';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import { mountProvider } from '../testing/mountProvider';
import { FRAME_RATE_WINDOW_MS } from '../src/camera/frameRate';
import { tunedSettings, WINDOWS_TO_GIVE_UP } from '../src/camera/autoTune';
import { SENSITIVITY_PROFILES } from '../src/ml/sensitivity';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

jest.mock('../src/surveillance/foregroundService');

const SETTINGS_KEY = '@novaguard:settings';

/** One analysed frame per window: 0,5 i/s against the 3 i/s "Moyenne" asks for. */
async function starve(
  state: { reportDetections: (d: [], aspect: number) => void },
  windows: number,
) {
  await ReactTestRenderer.act(async () => {
    state.reportDetections([], 9 / 16);           // opens the first window
    for (let i = 0; i < windows; i++) {
      jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS);
      state.reportDetections([], 9 / 16);
    }
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (useCameraPermission as jest.Mock).mockReturnValue({
    hasPermission: true, requestPermission: jest.fn(async () => true),
  });
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('leaves the camera alone while the device keeps up', async () => {
  const handle = await mountProvider();
  const target = SENSITIVITY_PROFILES[defaultSettings.sens].fps;

  await ReactTestRenderer.act(async () => {
    handle.state.reportDetections([], 9 / 16);
    for (let i = 0; i < WINDOWS_TO_GIVE_UP * 2; i++) {
      // Enough frames in the window to meet the target.
      for (let f = 0; f < target * 2; f++) {
        jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS / (target * 2));
        handle.state.reportDetections([], 9 / 16);
      }
    }
  });

  expect(handle.state.autoTune.applied).toEqual([]);
});

it('gives up the auto-zoom when the device cannot hold the cadence', async () => {
  const handle = await mountProvider();

  await starve(handle.state, WINDOWS_TO_GIVE_UP);

  expect(handle.state.autoTune.applied).toEqual(['autoZoom']);
  // What the camera runs with, which is not what the user chose.
  expect(tunedSettings(handle.state.settings, handle.state.autoTune).autoZoom).toBe(false);
});

it('never rewrites what the user asked for', async () => {
  const handle = await mountProvider();

  await starve(handle.state, WINDOWS_TO_GIVE_UP);

  // The setting is the user's; the tuning is this session's reading of the
  // device. Writing one into the other would outlive the phone getting warm.
  expect(handle.state.settings.autoZoom).toBe(true);
  const written = await AsyncStorage.getItem(SETTINGS_KEY);
  if (written) expect((JSON.parse(written) as Settings).autoZoom).toBe(true);
});

it('forgets its verdict when surveillance stops', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

  await starve(handle.state, WINDOWS_TO_GIVE_UP);
  expect(handle.state.autoTune.applied).toEqual(['autoZoom']);

  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

  // What a phone can hold up depends on the format it records, how warm it
  // already is and what else is running — none of which survives the session.
  expect(handle.state.autoTune.applied).toEqual([]);
  expect(handle.state.autoTune.decided).toBeNull();
});

/**
 * The two places the decision is actually spent are a camera and a preview
 * transform, neither of which exists under Jest: VisionCamera is mocked, and
 * `useAutoZoom`'s gate is a prop on a component that never mounts here. What
 * has to be true is a property of the source, so that is what is read — the
 * same reason `touchFeedback` and `workletSafety` read it.
 */
describe('the camera path spends the decision', () => {
  const source = (file: string) =>
    readFileSync(resolve(__dirname, '..', 'src', file), 'utf8');

  it('runs the camera on tuned settings, not the stored ones', () => {
    const camera = source('components/CameraFeed.tsx');

    expect(camera).toContain('tunedSettings(chosen, autoTune)');
    // Reading `settings` again from the context under that name would quietly
    // put the untuned values back on the frame path.
    expect(camera).not.toContain('settings, foreground, reportDetections } = useAppState()');
  });

  it('gates the auto-zoom on the decision as well as on the setting', () => {
    const viewfinder = source('components/Viewfinder.tsx');

    expect(viewfinder).toContain("!autoTune.applied.includes('autoZoom')");
  });
});
