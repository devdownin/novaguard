/**
 * Telling the user where the app died, when it died too hard to say so itself.
 *
 * The frame processor's `try` catches every JavaScript error and
 * `frameErrorGuard` catches what escapes it — but a segfault or an abort inside
 * libyuv, LiteRT or ML Kit ends the process before either runs. Nothing is
 * shown, nothing is written, the app simply stops existing. For a user without
 * a cable and adb, that is the entire failure report.
 *
 * So the analysis records the call it is *about to* make. A stage left behind
 * with no completion after it names the call the process was inside.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Viewfinder } from '../src/components/Viewfinder';
import { CameraFeed } from '../src/components/CameraFeed';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { AppState, mountProvider } from '../testing/mountProvider';
import {
  FRAME_STAGES, isCompleteFrame, isLaterStage, parseStage, stageDiagnosis,
} from '../src/camera/frameTrace';

jest.mock('../src/surveillance/foregroundService');

const STAGE_KEY = '@novaguard:frameStage';
const stored = () => AsyncStorage.getItem(STAGE_KEY);

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // `clearAllMocks` forgets the calls, not the return values a test set, so
  // without this a camera granted by one test is still granted in the next.
  (useCameraPermission as jest.Mock).mockReturnValue({
    hasPermission: false, requestPermission: jest.fn(),
  });
  (useCameraDevice as jest.Mock).mockReturnValue(undefined);
  await AsyncStorage.clear();
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

describe('the stage vocabulary', () => {
  it('orders the native steps the way surveillance takes them', () => {
    expect(FRAME_STAGES).toEqual(['camera', 'resize', 'inference', 'faces', 'report']);
  });

  it('only ever moves forward', () => {
    expect(isLaterStage('resize', 'camera')).toBe(true);
    expect(isLaterStage('inference', 'resize')).toBe(true);
    expect(isLaterStage('resize', 'inference')).toBe(false);
    expect(isLaterStage('resize', 'resize')).toBe(false);
    expect(isLaterStage('resize', null)).toBe(true);
  });

  it('blames the call, and says nothing about a frame that finished', () => {
    expect(stageDiagnosis('camera')).toContain('caméra');
    expect(stageDiagnosis('resize')).toContain('mise à l');
    expect(stageDiagnosis('inference')).toContain('modèle');
    expect(stageDiagnosis('faces')).toContain('visages');
    // A frame that reached the end is not a crash to report.
    expect(isCompleteFrame('report')).toBe(true);
    expect(stageDiagnosis('report')).toBeNull();
    expect(stageDiagnosis(null)).toBeNull();
  });

  it('carries the prefix the camera uses to clear its own messages', () => {
    // Without it the diagnosis would outlive the problem, sitting in the
    // viewfinder long after the camera proved it can get through a frame.
    expect(stageDiagnosis('resize')!.startsWith('Analyse')).toBe(true);
  });

  it('ignores a stage written by a build that named them differently', () => {
    expect(parseStage('resize')).toBe('resize');
    expect(parseStage('decode')).toBeNull();
    expect(parseStage(null)).toBeNull();
    expect(parseStage(42)).toBeNull();
  });
});

describe('recording a frame in flight', () => {
  it('writes the call down before it is made', async () => {
    const { state } = await mountProvider();

    await ReactTestRenderer.act(async () => { state.reportFrameStage('resize'); });

    // Persisted at that point, not after: the call it names may never return.
    await expect(stored()).resolves.toBe(JSON.stringify('resize'));
  });

  it('keeps the furthest call reached', async () => {
    const { state } = await mountProvider();

    await ReactTestRenderer.act(async () => {
      state.reportFrameStage('resize');
      state.reportFrameStage('inference');
    });
    await expect(stored()).resolves.toBe(JSON.stringify('inference'));

    // The next frame starts over at `resize`; that must not walk the record
    // back, or a crash in inference would be blamed on the resize.
    await ReactTestRenderer.act(async () => { state.reportFrameStage('resize'); });
    await expect(stored()).resolves.toBe(JSON.stringify('inference'));
  });

  it('clears the record once a frame gets all the way through', async () => {
    const { state } = await mountProvider();

    await ReactTestRenderer.act(async () => {
      state.reportFrameStage('resize');
      state.reportFrameStage('inference');
      state.reportFrameStage('report');
    });

    await expect(stored()).resolves.toBeNull();
  });

  it('stops writing after that, instead of recording every frame for ever', async () => {
    // The completed stage is also the furthest one, so the ordering rule alone
    // makes the whole thing a no-op for the rest of the session — which is what
    // keeps a write off a path that runs five times a second.
    const { state } = await mountProvider();
    await ReactTestRenderer.act(async () => { state.reportFrameStage('report'); });

    const writes = jest.spyOn(AsyncStorage, 'setItem');
    await ReactTestRenderer.act(async () => {
      for (const stage of FRAME_STAGES) state.reportFrameStage(stage);
    });

    expect(writes.mock.calls.filter(([key]) => key === STAGE_KEY)).toEqual([]);
    await expect(stored()).resolves.toBeNull();
    writes.mockRestore();
  });
});

describe('the camera opening', () => {
  /** Enough of a device for `CameraFeed` to render a real `Camera`. */
  function withCamera() {
    (useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: true, requestPermission: jest.fn(),
    });
    (useCameraDevice as jest.Mock).mockReturnValue({ id: 'back', position: 'back' });
  }

  /** A `CameraFeed` reporting stages the way `Viewfinder` wires it. */
  function Feed({ active }: { active: boolean }) {
    const { reportFrameStage } = useAppState();
    return (
      <CameraFeed
        style={null}
        active={active}
        viewWidth={320}
        viewHeight={640}
        onStage={reportFrameStage}
      />
    );
  }

  it('is written down before a single frame arrives', async () => {
    // Opening a session is native too. A launch that dies in CameraX never
    // reaches the frame processor, so without this its trace is empty — which
    // reads exactly like a launch that never started surveillance.
    withCamera();
    await mountProvider(<Feed active />);

    await expect(stored()).resolves.toBe(JSON.stringify('camera'));
  });

  it('says nothing while the camera is not running', async () => {
    withCamera();
    await mountProvider(<Feed active={false} />);
    await expect(stored()).resolves.toBeNull();
  });

  it('blames no camera that was never opened', async () => {
    // Permission held, but no device matches the chosen lens: `CameraFeed`
    // renders nothing, so there is no session to accuse of anything.
    withCamera();
    (useCameraDevice as jest.Mock).mockReturnValue(undefined);
    await mountProvider(<Feed active />);
    await expect(stored()).resolves.toBeNull();
  });

  it('is what the viewfinder hands the camera', async () => {
    // The three tests above drive `CameraFeed` directly; this is the join that
    // makes them mean anything in the app. Read off the tree rather than by
    // turning surveillance on, which would start the scan-beam animation and
    // the foreground service for a fact neither of them decides.
    withCamera();
    const handle = {} as { state: AppState };
    function Probe() {
      handle.state = useAppState();
      return <CameraFeed style={null} active={false} viewWidth={320} viewHeight={640} />;
    }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppStateProvider><Viewfinder /><Probe /></AppStateProvider>);
    });
    await ReactTestRenderer.act(async () => {});

    const feeds = tree.root.findAllByType(CameraFeed);
    const viewfinderFeed = feeds.find(feed => feed.props.onStage != null);
    expect(viewfinderFeed?.props.onStage).toBe(handle.state.reportFrameStage);
  });
});

describe('reading it back at launch', () => {
  it('says which call the last session died in', async () => {
    await AsyncStorage.setItem(STAGE_KEY, JSON.stringify('inference'));

    const app = await mountProvider();

    expect(app.state.recError).toBe(stageDiagnosis('inference'));
    expect(app.state.recError).toContain('modèle');
  });

  it('says nothing when the last session finished a frame', async () => {
    // `report` is only ever written by a frame that completed — and it clears
    // itself — but a build that stored it must not become a false alarm.
    await AsyncStorage.setItem(STAGE_KEY, JSON.stringify('report'));

    const app = await mountProvider();

    expect(app.state.recError).toBeNull();
  });

  it('says nothing on a launch with no record at all', async () => {
    const app = await mountProvider();
    expect(app.state.recError).toBeNull();
  });

  it('takes the diagnosis down once a frame proves the camera works', async () => {
    await AsyncStorage.setItem(STAGE_KEY, JSON.stringify('faces'));
    const app = await mountProvider();
    expect(app.state.recError).not.toBeNull();

    await ReactTestRenderer.act(async () => {
      app.state.reportFrameStage('resize');
      app.state.reportFrameStage('report');
    });

    expect(app.state.recError).toBeNull();
  });

  it('leaves a message the camera does not own standing', async () => {
    // `recError` is shared with the recorder and the foreground service. A
    // frame getting through says nothing about a failed save, so clearing on
    // completion must not wipe one.
    await AsyncStorage.setItem(STAGE_KEY, JSON.stringify('resize'));
    const app = await mountProvider();

    await ReactTestRenderer.act(async () => {
      app.state.reportCameraProblem('Enregistrement impossible : stockage plein');
      app.state.reportFrameStage('report');
    });

    expect(app.state.recError).toBe('Enregistrement impossible : stockage plein');
  });
});
