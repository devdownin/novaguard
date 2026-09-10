/**
 * The recording state machine.
 *
 * VisionCamera hands a clip back through a callback rather than a promise, and
 * throws if you stop a recording that never started — so the in-flight state
 * lives in a ref that four different paths read. Every clip-loss bug fixed so
 * far ran through here, and none of it was covered.
 *
 * @format
 */

import React, { useRef } from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { Camera } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { Clip, FINALIZE_TIMEOUT_MS, useRecorder } from '../src/recording/useRecorder';
import { MaxDuration } from '../src/state/types';
import { maxDurationMs } from '../src/recording/library';
import { RECORDINGS_DIR } from '../src/recording/videoStore';

const mockFs = fs as jest.Mocked<typeof fs>;

interface Harness {
  recorder: ReturnType<typeof useRecorder>;
  camera: { startRecording: jest.Mock; stopRecording: jest.Mock };
}

const SNAPSHOT = `${RECORDINGS_DIR}/snap.jpg`;

/** Captures VisionCamera's two callbacks so a test can fire them itself. */
function fakeCamera() {
  const calls: { onRecordingFinished: Function; onRecordingError: Function }[] = [];
  return {
    calls,
    startRecording: jest.fn(opts => calls.push(opts)),
    stopRecording: jest.fn(),
    // The still kept for the history. Answers a path by default so the clip
    // carries one; a test that wants the screen-off case rejects it.
    takeSnapshot: jest.fn(async () => ({ path: SNAPSHOT })),
    last: () => calls[calls.length - 1],
  };
}

async function mount(
  camera: ReturnType<typeof fakeCamera>,
  {
    enabled = true, max = '1 min' as MaxDuration, onClip = jest.fn(), onError = jest.fn(),
    onMaxDuration = jest.fn(), onAbandoned = jest.fn(), onEncoderFree = jest.fn(),
  } = {},
) {
  const box = {} as Harness & { onClip: jest.Mock; onError: jest.Mock; unmount: () => void };
  box.onClip = onClip as jest.Mock;
  box.onError = onError as jest.Mock;

  function Probe({ enabled: on, max: cap }: { enabled: boolean; max: MaxDuration }) {
    const ref = useRef<Camera | null>(camera as unknown as Camera);
    box.recorder = useRecorder({
      cameraRef: ref, enabled: on, max: cap, onClip, onError, onMaxDuration, onAbandoned,
      onEncoderFree,
    });
    return null;
  }

  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Probe enabled={enabled} max={max} />);
  });
  // `ensureRecordingsDir` resolves on the next tick; until it does, start() refuses.
  await ReactTestRenderer.act(async () => {});

  box.unmount = () => ReactTestRenderer.act(() => { tree.unmount(); });
  return Object.assign(box, {
    rerender: async (props: { enabled: boolean; max: MaxDuration }) => {
      await ReactTestRenderer.act(async () => { tree.update(<Probe {...props} />); });
    },
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFs.exists.mockResolvedValue(true);
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.stat.mockResolvedValue({ size: 4096 } as never);
});

afterEach(() => {
  jest.useRealTimers();
});

it('starts a recording and reports it', async () => {
  const camera = fakeCamera();
  const h = await mount(camera);

  let started!: boolean;
  await ReactTestRenderer.act(async () => { started = h.recorder.start(); });

  expect(started).toBe(true);
  expect(camera.startRecording).toHaveBeenCalledTimes(1);
  expect(camera.startRecording.mock.calls[0][0]).toMatchObject({ fileType: 'mp4', videoCodec: 'h264' });
  expect(h.recorder.isRecording).toBe(true);
});

it('refuses a second start while one is in flight', async () => {
  const camera = fakeCamera();
  const h = await mount(camera);

  let second!: boolean;
  await ReactTestRenderer.act(async () => {
    h.recorder.start();
    second = h.recorder.start();
  });

  // A start() slipping in before the stop callback fires throws inside
  // VisionCamera, so the recorder has to refuse it itself.
  expect(second).toBe(false);
  expect(camera.startRecording).toHaveBeenCalledTimes(1);
});

it('refuses to start when disabled', async () => {
  const camera = fakeCamera();
  const h = await mount(camera, { enabled: false });

  let started!: boolean;
  await ReactTestRenderer.act(async () => { started = h.recorder.start(); });

  expect(started).toBe(false);
  expect(camera.startRecording).not.toHaveBeenCalled();
});

it('hands the finished clip over with its real size read from disk', async () => {
  const camera = fakeCamera();
  const onClip = jest.fn();
  const h = await mount(camera, { onClip });

  await ReactTestRenderer.act(async () => { h.recorder.start(); });
  await ReactTestRenderer.act(async () => {
    camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 12.4 });
  });

  // `VideoFile` carries no size, so it comes from stat() once the file closed.
  expect(onClip).toHaveBeenCalledWith<[Clip]>({
    path: '/clips/a.mp4', bytes: 4096, duration: 12.4, thumbPath: SNAPSHOT,
  });
  expect(h.recorder.isRecording).toBe(false);
});

it('stop() returns false when nothing is recording, so the caller closes the session itself', async () => {
  const camera = fakeCamera();
  const h = await mount(camera);

  let stopped!: boolean;
  await ReactTestRenderer.act(async () => { stopped = h.recorder.stop(); });

  expect(stopped).toBe(false);
  expect(camera.stopRecording).not.toHaveBeenCalled();
});

it('keeps the recording marked active until the callback lands', async () => {
  const camera = fakeCamera();
  const h = await mount(camera);

  await ReactTestRenderer.act(async () => { h.recorder.start(); });
  let stopped!: boolean;
  await ReactTestRenderer.act(async () => { stopped = h.recorder.stop(); });

  expect(stopped).toBe(true);
  // Stopping is asynchronous: a start() before the callback would throw.
  await ReactTestRenderer.act(async () => {
    expect(h.recorder.start()).toBe(false);
  });
});

it('cuts the clip at the configured maximum duration', async () => {
  const camera = fakeCamera();
  const h = await mount(camera, { max: '1 min' });

  await ReactTestRenderer.act(async () => { h.recorder.start(); });

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(maxDurationMs('1 min') - 1); });
  expect(camera.stopRecording).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1); });
  expect(camera.stopRecording).toHaveBeenCalledTimes(1);
});

it('drops the duration cap once the clip has landed, so it cannot cut the next one short', async () => {
  const cap = maxDurationMs('1 min');
  const camera = fakeCamera();
  const h = await mount(camera, { max: '1 min' });

  // First clip runs briefly and ends well before its cap would fire.
  await ReactTestRenderer.act(async () => { h.recorder.start(); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1_000); });
  await ReactTestRenderer.act(async () => {
    camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 1 , thumbPath: null});
  });

  // A long second passage opens. Asserting only "the cap did not fire after the
  // clip landed" would pass even with the timer left running, because `stop()`
  // no-ops when nothing is active — the stale timer only does damage once
  // something IS active again.
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1_000); });
  await ReactTestRenderer.act(async () => { h.recorder.start(); });

  // Past the first recording's deadline, still short of the second's.
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(cap - 1_500); });
  expect(camera.stopRecording).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2_000); });
  expect(camera.stopRecording).toHaveBeenCalledTimes(1);
});

/**
 * The cap ends a file; whether it ends the *passage* is not the recorder's
 * call. Handing the expiry over first is what lets the session layer close the
 * clip with its own metadata and open the next one — before that, the session
 * was torn down and rebuilt from the next frame.
 */
describe('the duration cap', () => {
  it('hands the expiry to the session layer before cutting', async () => {
    const camera = fakeCamera();
    const onMaxDuration = jest.fn();
    const h = await mount(camera, { max: '1 min', onMaxDuration });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    expect(onMaxDuration).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(maxDurationMs('1 min')); });
    expect(onMaxDuration).toHaveBeenCalledTimes(1);
  });

  it('does not cut a second time when the handler already stopped the clip', async () => {
    const camera = fakeCamera();
    const box = {} as { recorder: ReturnType<typeof useRecorder> };
    const onMaxDuration = jest.fn(() => { box.recorder.stop(); });
    const h = await mount(camera, { max: '1 min', onMaxDuration });
    box.recorder = h.recorder;

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(maxDurationMs('1 min')); });

    // A second stopRecording() throws inside VisionCamera, and the old code
    // read that throw as proof nothing was recording.
    expect(camera.stopRecording).toHaveBeenCalledTimes(1);
  });

  it('still cuts the clip when the handler does nothing', async () => {
    const camera = fakeCamera();
    const h = await mount(camera, { max: '1 min', onMaxDuration: jest.fn() });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(maxDurationMs('1 min')); });

    // Otherwise a handler that declined to act would turn the maximum duration
    // into no maximum at all, which is an MP4 that grows until the encoder quits.
    expect(camera.stopRecording).toHaveBeenCalledTimes(1);
  });
});

describe('a stop the encoder never answers', () => {
  it('says so, since no clip is coming', async () => {
    const camera = fakeCamera();
    const onAbandoned = jest.fn();
    const h = await mount(camera, { onAbandoned });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { h.recorder.stop(); });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(FINALIZE_TIMEOUT_MS - 1);
    });
    expect(onAbandoned).not.toHaveBeenCalled();

    // Whatever the caller set aside for that clip — the event it was to carry —
    // is otherwise dropped without a word.
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1); });
    expect(onAbandoned).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the clip does land', async () => {
    const camera = fakeCamera();
    const onAbandoned = jest.fn();
    const h = await mount(camera, { onAbandoned });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { h.recorder.stop(); });
    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 3 , thumbPath: null});
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(FINALIZE_TIMEOUT_MS * 2);
    });

    // The clip was handed over; announcing it abandoned as well would have the
    // caller write a second, file-less event for it.
    expect(onAbandoned).not.toHaveBeenCalled();
  });
});

it('surfaces an encoder error and clears the in-flight state', async () => {
  const camera = fakeCamera();
  const onError = jest.fn();
  const h = await mount(camera, { onError });

  await ReactTestRenderer.act(async () => { h.recorder.start(); });
  await ReactTestRenderer.act(async () => {
    camera.last().onRecordingError({ message: 'no space left' });
  });

  expect(onError).toHaveBeenCalledWith('no space left');
  expect(h.recorder.isRecording).toBe(false);
  // The failure must leave the recorder able to try again.
  await ReactTestRenderer.act(async () => { expect(h.recorder.start()).toBe(true); });
});

it('surfaces a throwing startRecording instead of pretending to record', async () => {
  const camera = fakeCamera();
  camera.startRecording.mockImplementation(() => { throw new Error('camera busy'); });
  const onError = jest.fn();
  const h = await mount(camera, { onError });

  let started!: boolean;
  await ReactTestRenderer.act(async () => { started = h.recorder.start(); });

  expect(started).toBe(false);
  expect(onError).toHaveBeenCalledWith('camera busy');
  expect(h.recorder.isRecording).toBe(false);
});

it('stops the encoder when recording is disabled mid-clip', async () => {
  const camera = fakeCamera();
  const h = await mount(camera, { enabled: true });

  await ReactTestRenderer.act(async () => { h.recorder.start(); });
  await h.rerender({ enabled: false, max: '1 min' });

  // Monitoring off must not leave the encoder writing a file nothing will claim.
  expect(camera.stopRecording).toHaveBeenCalledTimes(1);
});

it('stops the encoder on unmount', async () => {
  const camera = fakeCamera();
  const h = await mount(camera);

  await ReactTestRenderer.act(async () => { h.recorder.start(); });
  h.unmount();

  expect(camera.stopRecording).toHaveBeenCalledTimes(1);
});

it('reports an unusable recordings directory rather than failing silently', async () => {
  mockFs.exists.mockResolvedValue(false);
  mockFs.mkdir.mockRejectedValue(new Error('EACCES'));
  const camera = fakeCamera();
  const onError = jest.fn();
  const h = await mount(camera, { onError });

  expect(onError).toHaveBeenCalledWith("Dossier d'enregistrement inaccessible");
  // And it must not pretend it can record.
  await ReactTestRenderer.act(async () => { expect(h.recorder.start()).toBe(false); });
});

describe('a stop that is still in flight', () => {
  it('stays "recording" so the camera session is not torn down under the clip', async () => {
    const camera = fakeCamera();
    const h = await mount(camera);

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { h.recorder.stop(); });

    // The viewfinder passes `active={monitoring || recording}`: dropping this
    // flag before the encoder answers closes the capture session while the file
    // is still being finalised.
    expect(h.recorder.isRecording).toBe(true);

    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 3 , thumbPath: null});
    });
    expect(h.recorder.isRecording).toBe(false);
  });

  it('is not stopped a second time when monitoring goes off', async () => {
    const camera = fakeCamera();
    const h = await mount(camera);

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { h.recorder.stop(); });
    // The provider stops the session and then drops `enabled` in the same turn.
    await h.rerender({ enabled: false, max: '1 min' });

    // The second call throws inside VisionCamera, and the old code read that
    // throw as "nothing was recording" — clearing the flag mid-finalisation.
    expect(camera.stopRecording).toHaveBeenCalledTimes(1);
    expect(h.recorder.isRecording).toBe(true);
  });

  it('releases the camera anyway if the encoder never answers', async () => {
    const camera = fakeCamera();
    const h = await mount(camera);

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => { h.recorder.stop(); });

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(FINALIZE_TIMEOUT_MS - 1);
    });
    expect(h.recorder.isRecording).toBe(true);

    // Otherwise a callback that never lands leaves the preview running with
    // surveillance switched off, and no way back.
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1); });
    expect(h.recorder.isRecording).toBe(false);
    await ReactTestRenderer.act(async () => { expect(h.recorder.start()).toBe(true); });
  });
});

describe('the still kept for the history', () => {
  it('is taken as the clip opens, into the recordings directory', async () => {
    const camera = fakeCamera();
    const h = await mount(camera);

    await ReactTestRenderer.act(async () => { h.recorder.start(); });

    // Not `takePhoto`: that needs a photo output in the capture session, and
    // reconfiguring the session mid-passage is what this repo already paid for.
    expect(camera.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(camera.takeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: RECORDINGS_DIR }),
    );
    // Straight into the recordings directory rather than the temp one, so the
    // launch sweep accounts for it like every other file there.
    expect(camera.startRecording).toHaveBeenCalledTimes(1);
  });

  it('never holds the clip up: the encoder is released first', async () => {
    const camera = fakeCamera();
    const onEncoderFree = jest.fn();
    // A snapshot that never lands. The clip must not be reported before it —
    // that would orphan the JPEG — but the camera must be freed regardless.
    camera.takeSnapshot.mockReturnValue(new Promise(() => {}));
    const onClip = jest.fn();
    const h = await mount(camera, { onClip, onEncoderFree });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 3 });
    });

    expect(onEncoderFree).toHaveBeenCalledTimes(1);
    expect(onClip).not.toHaveBeenCalled();
  });

  it('files the clip without one when there is no preview to snapshot', async () => {
    const camera = fakeCamera();
    // What a clip recorded with the screen off gets: `preview` is off, so the
    // GPU view screenshot has no view. The clip is worth more than the still.
    camera.takeSnapshot.mockRejectedValue(new Error('no preview'));
    const onClip = jest.fn();
    const h = await mount(camera, { onClip });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 3 });
    });

    expect(onClip).toHaveBeenCalledWith(expect.objectContaining({
      path: '/clips/a.mp4', thumbPath: null,
    }));
  });

  it('deletes the still when the encoder errors and no clip is coming', async () => {
    const camera = fakeCamera();
    const h = await mount(camera);

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingError({ message: 'encoder died' });
    });
    await ReactTestRenderer.act(async () => {});

    // Nothing will ever point at it, and only the next launch would sweep it.
    expect(mockFs.unlink).toHaveBeenCalledWith(SNAPSHOT);
  });

  it('takes a fresh one for each clip of a long passage', async () => {
    const camera = fakeCamera();
    const onClip = jest.fn();
    const h = await mount(camera, { onClip });

    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: 60 });
    });
    camera.takeSnapshot.mockResolvedValueOnce({ path: `${RECORDINGS_DIR}/snap2.jpg` });
    await ReactTestRenderer.act(async () => { h.recorder.start(); });
    await ReactTestRenderer.act(async () => {
      camera.last().onRecordingFinished({ path: '/clips/b.mp4', duration: 60 });
    });

    // The second clip carries its own frame, not the first one's — which would
    // also mean two events pointing at one file, so deleting either breaks the other.
    expect(onClip.mock.calls.map(c => c[0].thumbPath))
      .toEqual([SNAPSHOT, `${RECORDINGS_DIR}/snap2.jpg`]);
  });
});
