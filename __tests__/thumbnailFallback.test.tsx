/**
 * A picture for the clips recorded with the screen off.
 *
 * The still is taken by `takeSnapshot`, which screenshots the preview view —
 * it touches neither the encoder nor the capture session, and that is exactly
 * why it was chosen. Its cost is written down beside the call: there is no
 * preview to screenshot with the screen off, and the screen being off is most
 * of what a surveillance phone does. Those clips kept the placeholder, so the
 * history was back to identical rows for precisely the passages nobody was
 * watching live — the ones the history exists for.
 *
 * Reading the file answers that without going near the session: the clip is on
 * disk by then, and a decoder does not care what the screen was doing. It is a
 * backstop, not a replacement — the snapshot is the better picture, being the
 * frame that says why the clip exists — so what is asserted here is the
 * ordering, not the picture: asked only when the snapshot came back empty,
 * asked against the clip's final name, and never at the price of an event.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from '@dr.pogodin/react-native-fs';
import { useCameraPermission } from 'react-native-vision-camera';
import { mountProvider } from '../testing/mountProvider';
import { extractThumbnail } from '../src/surveillance/foregroundService';
import { FrameDetection } from '../src/ml/types';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const permission = useCameraPermission as jest.Mock;
const decode = extractThumbnail as jest.MockedFunction<typeof extractThumbnail>;

const CLIP = '/tmp/novaguard-test/recordings/2026-09-05_14-32-10.mp4';
const SNAPSHOT = '/tmp/novaguard-test/recordings/snapshot-1.jpg';
const DECODED = '/tmp/novaguard-test/recordings/2026-09-05_14-32-10.jpg';

const person = (x: number): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

function fakeCamera() {
  const calls: { onRecordingFinished: Function }[] = [];
  return {
    calls,
    startRecording: jest.fn(opts => calls.push(opts)),
    stopRecording: jest.fn(),
    // What the recorder asks for as the clip opens. `null` is the screen-off
    // answer: there was no preview to screenshot.
    takeSnapshot: jest.fn(async () => ({ path: SNAPSHOT })),
    last: () => calls[calls.length - 1],
  };
}

async function settle() {
  await ReactTestRenderer.act(async () => {});
}

/** One passage, recorded and landed, with the camera the test hands in. */
async function recordOnePassage(camera: ReturnType<typeof fakeCamera>) {
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  const handle = await mountProvider();
  handle.state.cameraRef.current = camera as never;

  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  for (let i = 0; i < 3; i++) {
    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([person(0.3 + i * 0.001)], 9 / 16);
    });
  }
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  await ReactTestRenderer.act(async () => {
    camera.last().onRecordingFinished({ path: CLIP, duration: 6 });
  });
  await settle();
  await settle();
  return handle;
}

/** A camera whose preview cannot be snapshotted — the screen-off case. */
function screenOff() {
  const camera = fakeCamera();
  camera.takeSnapshot = jest.fn(async () => { throw new Error('no preview'); });
  return camera;
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(false);
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.moveFile.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  mockFs.readDir.mockResolvedValue([] as never);
  mockFs.stat.mockResolvedValue({ size: 8_000_000 } as never);
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: 500_000_000_000, totalSpace: 1_000_000_000_000,
    freeSpaceEx: 500_000_000_000, totalSpaceEx: 1_000_000_000_000,
  } as never);
  decode.mockResolvedValue(DECODED);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

describe('when the preview could be snapshotted', () => {
  it('keeps that still and reads no file', async () => {
    // The snapshot is the frame that says why the clip exists; decoding the
    // first frame of the file as well would be one native decode per clip for
    // a picture nobody would see.
    const handle = await recordOnePassage(fakeCamera());

    expect(handle.state.events[0].thumbPath).toBe(SNAPSHOT);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('when there was no preview to snapshot', () => {
  it('reads a still out of the clip instead', async () => {
    const handle = await recordOnePassage(screenOff());

    expect(handle.state.events[0].thumbPath).toBe(DECODED);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('reads it under the name the clip ends up with', async () => {
    // The still is written beside the clip by replacing the extension, and
    // `eventFiles` deletes the pair by name. Asking before the rename would put
    // it next to a file that no longer exists, and nothing would ever reclaim it.
    const handle = await recordOnePassage(screenOff());

    expect(decode.mock.calls[0][0]).toBe(handle.state.events[0].path);
  });

  it('files the event anyway when the clip will not decode either', async () => {
    decode.mockResolvedValue(null);
    const handle = await recordOnePassage(screenOff());

    expect(handle.state.events).toHaveLength(1);
    expect(handle.state.events[0].path).toBeTruthy();
    expect(handle.state.events[0].thumbPath).toBeNull();
  });

  it('never makes the event wait for the decode', async () => {
    // A decode that never answers must not cost a recording — the same rule
    // `onClipAbandoned` exists for.
    decode.mockReturnValue(new Promise(() => {}));
    const handle = await recordOnePassage(screenOff());

    expect(handle.state.events).toHaveLength(1);
    expect(handle.state.events[0].thumbPath).toBeNull();
  });

  it('costs nothing when the event was deleted while the frame was decoding', async () => {
    // Not about reviving the row — `map` over a list without it cannot. It is
    // about the new array: a fresh `events` reference re-renders the history
    // and rewrites the whole journal to AsyncStorage for a change that did not
    // happen. Identity is the assertion, as it is for `confirmedTracksIfChanged`.
    let land: (path: string) => void = () => {};
    decode.mockReturnValue(new Promise(resolve => { land = resolve; }));
    const handle = await recordOnePassage(screenOff());

    await ReactTestRenderer.act(async () => {
      handle.state.selectEvent(handle.state.events[0].id);
    });
    await ReactTestRenderer.act(async () => { handle.state.askDelete(); });
    await ReactTestRenderer.act(async () => { handle.state.doDelete(); });
    await settle();
    const after = handle.state.events;
    expect(after).toHaveLength(0);

    await ReactTestRenderer.act(async () => { land(DECODED); });
    await settle();
    expect(handle.state.events).toBe(after);
  });
});

describe('an event with no file at all', () => {
  it('is never decoded', async () => {
    // "event-only": the encoder produced an empty file. There is nothing to
    // read, and the sighting is still worth keeping.
    mockFs.stat.mockResolvedValue({ size: 0 } as never);
    const handle = await recordOnePassage(screenOff());

    expect(handle.state.events[0].path).toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });
});
