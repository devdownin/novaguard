/**
 * What a re-render of the camera costs.
 *
 * `useFaceDetector` memoizes on the identity of the options object it is given,
 * and `CameraFeed` used to build that object inline. Every render therefore
 * constructed a new native plugin — and with it an ML Kit `FaceDetector` that
 * has no closing path — while churning `detectFaces`, whose identity feeds the
 * frame processor's dependency list. `CameraFeed` reads the main app context,
 * so that happened on every detection, every recording state change and every
 * disk sweep: the exact churn the rest of the file is written to avoid.
 *
 * @format
 */

import React, { useState } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import faceDetector from 'react-native-vision-camera-face-detector';
import tflite from 'react-native-fast-tflite';
import { AppStateProvider } from '../src/state/AppStateContext';
import { CameraFeed } from '../src/components/CameraFeed';
import { mountProvider } from '../testing/mountProvider';

jest.mock('../src/surveillance/foregroundService');

const tfliteMock = tflite as unknown as {
  __calls: () => { source: unknown; delegate: string }[];
  __reset: () => void;
};

const STANDARD = require('../assets/models/efficientdet-lite0.tflite');
const PRECISE = require('../assets/models/efficientdet-lite2.tflite');

const detectorMock = faceDetector as unknown as {
  __created: () => unknown[];
  __stopListeners: jest.Mock;
  __reset: () => void;
};

/** Renders one CameraFeed and lets a test change the viewfinder size. */
function Harness({ handle }: { handle: { resize: (size: number) => void } }) {
  const [size, setSize] = useState(320);
  handle.resize = setSize;
  return <CameraFeed style={null} active viewWidth={size} viewHeight={size * 2} />;
}

async function mount() {
  const resizer = {} as { resize: (size: number) => void };
  const box = await mountProvider(<Harness handle={resizer} />);
  // Not spread into a new object: `box.state` is reassigned on every render,
  // and a copy pins the first one — including callbacks that close over the
  // settings as they were then.
  return { box, resizer };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  detectorMock.__reset();
  tfliteMock.__reset();
  await AsyncStorage.clear();
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('builds one face detector, not one per render', async () => {
  const { box } = await mount();
  expect(detectorMock.__created()).toHaveLength(1);

  // Three context changes CameraFeed sits downstream of, none of which has
  // anything to do with face detection.
  await ReactTestRenderer.act(async () => { box.state.setTab('hist'); });
  await ReactTestRenderer.act(async () => { box.state.setTab('cam'); });
  await ReactTestRenderer.act(async () => { box.state.cycleQuality(); });

  expect(detectorMock.__created()).toHaveLength(1);
});

it('builds a new one when the bounds it was given actually change', async () => {
  // The options carry the viewfinder size — face bounds come back in that
  // space — so this one has to rebuild, or the boxes land in the wrong place.
  const { resizer } = await mount();
  await ReactTestRenderer.act(async () => { resizer.resize(500); });

  expect(detectorMock.__created()).toHaveLength(2);
});

it('builds a new one when the camera is flipped', async () => {
  const { box } = await mount();
  // 'Arrière (1×)' → 'Arrière (0,5×)': same position, so nothing to rebuild.
  await ReactTestRenderer.act(async () => { box.state.cycleCamera(); });
  expect(detectorMock.__created()).toHaveLength(1);

  // → 'Avant': the plugin is told which way the camera faces, so it must.
  await ReactTestRenderer.act(async () => { box.state.cycleCamera(); });
  expect(detectorMock.__created()).toHaveLength(2);
});

it('takes the ML Kit listeners back down', async () => {
  // `stopListeners` is the only teardown the library exposes; without it the
  // Android device-orientation listener outlives every plugin it was made for.
  const handle = {} as { resize: (size: number) => void };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AppStateProvider><Harness handle={handle} /></AppStateProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {});

  expect(detectorMock.__stopListeners).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => { tree.unmount(); });
  expect(detectorMock.__stopListeners).toHaveBeenCalled();
});

/**
 * "Détection étendue" is the third leg a setting needs: exposed, persisted and
 * *consumed*. The other two are checked in `settingsWiring.test.tsx`; only here
 * is it visible which file the camera actually asks the runtime to load, and a
 * switch that loads the same model either way is the inert-section failure this
 * repo has already shipped once.
 */
describe('which detector is loaded', () => {
  const sourcesAsked = () => tfliteMock.__calls().map(c => c.source);

  it('is the 320 px model by default', async () => {
    await mount();
    expect(sourcesAsked()).toContain(STANDARD);
    expect(sourcesAsked()).not.toContain(PRECISE);
  });

  it('is the 448 px model once the setting is on', async () => {
    const { box } = await mount();
    await ReactTestRenderer.act(async () => { box.state.togglePreciseDetection(); });
    expect(sourcesAsked()).toContain(PRECISE);
  });

  it('asks for two different files — the assets are not the same model twice', async () => {
    // Guards the two assertions above from passing on an asset transformer that
    // gives every `.tflite` the same handle.
    expect(STANDARD).not.toEqual(PRECISE);
  });
});
