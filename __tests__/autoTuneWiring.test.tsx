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
import { tunedSettings, WINDOWS_TO_GIVE_UP, WINDOWS_TO_GIVE_UP_HOT } from '../src/camera/autoTune';
import { DEVICE_LOAD_SWEEP_MS } from '../src/state/AppStateContext';
import { thermalStatus } from '../src/surveillance/foregroundService';
import { SENSITIVITY_PROFILES } from '../src/ml/sensitivity';
import { defaultSettings } from '../src/state/defaults';
import { FrameDetection } from '../src/ml/types';
import { Settings } from '../src/state/types';

jest.mock('../src/surveillance/foregroundService');

const SETTINGS_KEY = '@novaguard:settings';
const AUTOTUNE_KEY = '@novaguard:autotune:v1';
const thermal = thermalStatus as jest.Mock;

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

it('reads the heat while monitoring, and acts on it sooner', async () => {
  // Android CRITICAL: a second, independent witness that the phone is being
  // clocked down, so the loop does not wait out the usual evidence.
  thermal.mockReturnValue(4);
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(DEVICE_LOAD_SWEEP_MS); });

  await starve(handle.state, WINDOWS_TO_GIVE_UP_HOT);

  expect(thermal).toHaveBeenCalled();
  expect(handle.state.autoTune.applied).toEqual(['autoZoom']);
});

it('keeps what a format cost, and starts the next session there', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

  await starve(handle.state, WINDOWS_TO_GIVE_UP);

  // The app's own reading of the phone — not the user's settings, which this
  // must never write (see the test above).
  const written = JSON.parse((await AsyncStorage.getItem(AUTOTUNE_KEY))!);
  expect(written).toEqual({ [defaultSettings.quality]: ['autoZoom'] });
});

it('starts a session where the last one on this format ended up', async () => {
  await AsyncStorage.setItem(AUTOTUNE_KEY, JSON.stringify({ [defaultSettings.quality]: ['autoZoom'] }));
  const handle = await mountProvider();

  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

  // Six seconds of degraded detection not paid twice for the same phone on the
  // same format — and given back from the first sustained stretch of cadence,
  // because nothing about the verdict was restored with it.
  expect(handle.state.autoTune.applied).toEqual(['autoZoom']);
  expect(handle.state.autoTune.blocked).toEqual([]);
});

it('does nothing at all with self-tuning switched off', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleAutoTune(); });
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

  await starve(handle.state, WINDOWS_TO_GIVE_UP * 3);

  expect(handle.state.settings.autoTune).toBe(false);
  expect(handle.state.autoTune.applied).toEqual([]);
  expect(tunedSettings(handle.state.settings, handle.state.autoTune).autoZoom).toBe(true);
});

/**
 * The sensitivity step has to reach the tracker, not just the camera.
 *
 * "Sensibilité" moves three things together (`sensitivity.ts`): looks per
 * second, how many of them confirm a subject, and the score one has to reach.
 * A step that lowered only the cadence would buy frames and pay for them in a
 * corroboration the app can no longer afford — the exact failure that file
 * exists to prevent, one layer up.
 */
describe('a notch of sensitivity given up', () => {
  const person = (confidence: number): FrameDetection =>
    ({ kind: 'Personne', confidence, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.5 } });

  /** Long enough for the first step to be tried, fail, and the second to be taken. */
  const TO_SECOND_STEP = WINDOWS_TO_GIVE_UP * 3;

  it('confirms on one look, as "Basse" does', async () => {
    const handle = await mountProvider();
    await starve(handle.state, TO_SECOND_STEP);
    expect(handle.state.autoTune.applied).toEqual(['sensitivity']);

    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([person(0.9)], 9 / 16);
    });

    // "Moyenne" needs two consecutive looks; "Basse" pays for the one it gives
    // up with a higher score, which 0,9 clears.
    expect(handle.state.det).toBe('Personne');
  });

  it('still needs two looks while the notch is the user’s', async () => {
    const handle = await mountProvider();

    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([person(0.9)], 9 / 16);
    });

    expect(handle.state.autoTune.applied).toEqual([]);
    expect(handle.state.det).toBeNull();
  });
});
