/**
 * Not doing the work that only exists to be looked at.
 *
 * Surveillance is meant to run with the screen off — that is what the
 * foreground service is for — so the camera, the analysis, the tracking and the
 * recording all carry on regardless. What was carrying on with them was the
 * work whose sole product is something on screen: the preview stream, and the
 * viewfinder state the frame path pushed up to five times a second to move a
 * box on a display that was off. The app had no idea it was in the background
 * and did all of it anyway.
 *
 * The line these tests defend is the one that makes it a saving rather than a
 * regression: everything that decides what gets *recorded* must be untouched.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider, useAppState, useViewfinderState, ViewfinderState } from '../src/state/AppStateContext';
import { useForeground } from '../src/state/useForeground';
import { AppState as App, mountProvider } from '../testing/mountProvider';
import { FrameDetection } from '../src/ml/types';
import { CameraFeed } from '../src/components/CameraFeed';

jest.mock('../src/surveillance/foregroundService');

const permission = useCameraPermission as jest.Mock;

const person = (x: number): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

/** Drives the OS notification the hook subscribes to. */
function goTo(state: AppStateStatus) {
  const listener = (AppState.addEventListener as jest.Mock).mock.calls
    .map(([, handler]) => handler)
    .pop();
  ReactTestRenderer.act(() => { listener(state); });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  // A device is needed or CameraFeed renders nothing to inspect.
  (useCameraDevice as jest.Mock).mockReturnValue({
    id: 'back', position: 'back', minZoom: 1, maxZoom: 8, neutralZoom: 1,
    supportsLowLightBoost: false, formats: [],
  });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('deciding whether anyone is looking', () => {
  function mountHook() {
    const box = {} as { value: boolean };
    function Probe() {
      box.value = useForeground();
      return null;
    }
    ReactTestRenderer.act(() => { ReactTestRenderer.create(<Probe />); });
    return box;
  }

  it('assumes visible until told otherwise', () => {
    // `currentState` is undefined before the first event, and `unknown` for a
    // moment on a real device. Reading either as hidden would blank the preview
    // of an app somebody is looking at — the expensive direction to be wrong in.
    expect(mountHook().value).toBe(true);
  });

  it('counts only a definite background as hidden', () => {
    const box = mountHook();

    goTo('background');
    expect(box.value).toBe(false);

    goTo('active');
    expect(box.value).toBe(true);
  });

  it('keeps a transient inactive state visible', () => {
    const box = mountHook();

    // Android reports `inactive` under a permission dialog, which the user is
    // looking straight at.
    goTo('inactive');
    expect(box.value).toBe(true);
  });

  it('stops listening when it goes away', () => {
    const remove = jest.fn();
    (AppState.addEventListener as jest.Mock).mockReturnValue({ remove });
    let tree!: ReactTestRenderer.ReactTestRenderer;
    function Probe() { useForeground(); return null; }
    ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<Probe />); });

    ReactTestRenderer.act(() => { tree.unmount(); });

    expect(remove).toHaveBeenCalled();
  });
});

describe('the frame path in the background', () => {
  async function watching() {
    const box = {} as { viewfinder: ViewfinderState };
    function ViewfinderProbe() {
      box.viewfinder = useViewfinderState();
      return null;
    }
    const handle = await mountProvider(<ViewfinderProbe />);
    const see = async (n: number) => {
      await ReactTestRenderer.act(async () => {
        handle.state.reportDetections([person(0.3 + n * 0.001)], 9 / 16);
      });
    };
    return { get state() { return handle.state; }, get viewfinder() { return box.viewfinder; }, see };
  }

  it('still tracks and still opens a session with nobody looking', async () => {
    const p = await watching();
    goTo('background');

    await p.see(0);
    await p.see(1);
    await p.see(2);

    // The whole point of the app. If this ever goes quiet in the background,
    // the saving has eaten the product.
    expect(p.state.det).toBe('Personne');
  });

  it('stops pushing the overlay nobody can see', async () => {
    const p = await watching();
    await p.see(0);
    await p.see(1);
    await p.see(2);
    expect(p.viewfinder.tracks.length).toBeGreaterThan(0);
    const shownWhileWatching = p.viewfinder.tracks;

    goTo('background');
    for (let n = 3; n < 8; n++) {
      await p.see(n);
    }

    // Five more frames of a moving subject, and the overlay state has not been
    // written once: that is five re-renders of `ViewfinderProvider` saved, on a
    // screen that is off.
    expect(p.viewfinder.tracks).toBe(shownWhileWatching);
  });

  it('picks the overlay back up when the app returns', async () => {
    const p = await watching();
    await p.see(0);
    await p.see(1);
    goTo('background');
    await p.see(2);
    const stale = p.viewfinder.tracks;

    goTo('active');
    await p.see(3);

    // One frame of staleness on return — 200 ms at the analysis rate — and then
    // it is live again.
    expect(p.viewfinder.tracks).not.toBe(stale);
  });

  it('leaves the recording counter alone in the background, and resumes it after', async () => {
    const p = await watching();
    await p.see(0);
    await p.see(1);
    await p.see(2);

    goTo('background');
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(4000); });
    await p.see(3);
    const whileHidden = p.viewfinder.recSec;

    goTo('active');
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2000); });
    await p.see(4);

    // The counter is derived from the session's start, not accumulated, so it
    // comes back correct rather than short by the time spent hidden.
    expect(p.viewfinder.recSec).toBeGreaterThan(whileHidden);
    expect(p.viewfinder.recSec).toBeGreaterThanOrEqual(6);
  });
});

describe('what the camera is told', () => {
  it('stops streaming the preview, and only the preview', async () => {
    function Probe() {
      return <CameraFeed style={null} active viewWidth={320} viewHeight={640} />;
    }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppStateProvider><Probe /></AppStateProvider>);
    });
    await ReactTestRenderer.act(async () => {});

    const props = () => tree.root.findAllByType(Camera)[0].props;
    expect(props().preview).toBe(true);

    goTo('background');

    // `preview` alone. `isActive` staying true is what keeps the session, the
    // analysis and the recording running with the screen off — turning it off
    // here would stop surveillance instead of saving power.
    expect(props().preview).toBe(false);
    expect(props().isActive).toBe(true);
    expect(props().video).toBe(true);
  });

  it('reports the app as hidden so the preview can stop streaming', async () => {
    const handle = {} as { state: App };
    function Probe() { handle.state = useAppState(); return null; }
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(<AppStateProvider><Probe /></AppStateProvider>);
    });
    await ReactTestRenderer.act(async () => {});

    expect(handle.state.foreground).toBe(true);
    goTo('background');
    // `CameraFeed` passes this straight to `preview`; `isActive` is untouched,
    // so the session, the analysis and the recording all carry on.
    expect(handle.state.foreground).toBe(false);
  });
});
