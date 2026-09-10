/**
 * The provider used to hand every consumer a new context value on every
 * analysed frame, so the camera, the tab bar and the sheets all re-rendered up
 * to five times a second — including with nothing at all in front of the lens.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import { useAppState, useViewfinderState } from '../src/state/AppStateContext';
import { FRAME_RATE_WINDOW_MS } from '../src/camera/frameRate';
import { mountProvider } from '../testing/mountProvider';
import { FrameDetection } from '../src/ml/types';

jest.mock('../src/surveillance/foregroundService');

const person = (x: number): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

const renders = { app: 0, viewfinder: 0 };

function AppConsumer() {
  useAppState();
  renders.app++;
  return null;
}
const seen = { frameRate: 0 };
function ViewfinderConsumer() {
  seen.frameRate = useViewfinderState().frameRate;
  renders.viewfinder++;
  return null;
}

async function mount() {
  renders.app = 0;
  renders.viewfinder = 0;
  seen.frameRate = 0;
  return mountProvider(
    <>
      <AppConsumer />
      <ViewfinderConsumer />
    </>,
  );
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // Surveillance cannot be switched on without it, and one test below does.
  (useCameraPermission as jest.Mock).mockReturnValue({
    hasPermission: true, requestPermission: jest.fn(async () => true),
  });
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('does not re-render the main context while the scene stays empty', async () => {
  const { state } = await mount();
  const before = renders.app;

  await ReactTestRenderer.act(async () => {
    for (let i = 0; i < 20; i++) state.reportDetections([], 9 / 16);
  });

  expect(renders.app).toBe(before);
});

it('does not re-render the main context while a subject is tracked', async () => {
  const { state } = await mount();

  // Confirm a subject, then keep reporting it moving across the frame.
  await ReactTestRenderer.act(async () => {
    state.reportDetections([person(0.3)], 9 / 16);
    state.reportDetections([person(0.31)], 9 / 16);
  });
  const app = renders.app;
  const viewfinder = renders.viewfinder;

  await ReactTestRenderer.act(async () => {
    for (const x of [0.33, 0.35, 0.37, 0.39, 0.41]) {
      state.reportDetections([person(x)], 9 / 16);
    }
  });

  expect(renders.app).toBe(app);
  // The overlay still has to follow the subject.
  expect(renders.viewfinder).toBeGreaterThan(viewfinder);
});

it('keeps reportDetections stable so the frame processor is not rebuilt', async () => {
  const { state } = await mount();
  const first = state.reportDetections;

  await ReactTestRenderer.act(async () => {
    state.cyclePost();
    state.setSensitivity('Haute');
  });

  expect(state.reportDetections).toBe(first);
});

describe('the measured cadence', () => {
  it('reaches the viewfinder without touching the main context', async () => {
    // "Sensibilité" only sets a target; `runAsync` drops a frame whose
    // predecessor is still being analysed, so a device that cannot keep up
    // simply looks less often and used to say nothing about it.
    const { state } = await mount();
    const app = renders.app;

    await ReactTestRenderer.act(async () => {
      state.reportDetections([], 9 / 16);        // opens the window
      jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS / 2);
      state.reportDetections([], 9 / 16);
      jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS / 2);
      state.reportDetections([], 9 / 16);
    });

    // Two frames across a two-second window is one per second.
    expect(seen.frameRate).toBeCloseTo(1);
    expect(renders.app).toBe(app);
  });

  it('stays quiet until it has a full window to report', async () => {
    const { state } = await mount();

    await ReactTestRenderer.act(async () => {
      for (let i = 0; i < 5; i++) state.reportDetections([], 9 / 16);
    });

    // Reporting a rate off a fraction of a window would make the figure
    // jump around, which is worse than showing nothing.
    expect(seen.frameRate).toBe(0);
  });

  it('forgets the old rate when surveillance stops', async () => {
    // Through the handle: `toggleMonitoring` closes over `monitoring`, so a
    // destructured copy would start a second session instead of stopping the first.
    const handle = await mount();
    await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([], 9 / 16);
      jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS);
      handle.state.reportDetections([], 9 / 16);
    });
    expect(seen.frameRate).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
    // A stale figure next to a stopped camera reads as a camera still running.
    expect(seen.frameRate).toBe(0);
  });
});
