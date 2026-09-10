/**
 * A passage that outlasts the maximum clip duration.
 *
 * The cap has to end a *file* — an unbounded MP4 is one the encoder eventually
 * refuses and no retention sweep can trim by halves. It must not end what is
 * being filmed. The recorder used to stop behind the session's back, so the
 * session was torn down and rebuilt from the next frame: the counter restarted,
 * the badge dropped, the notification fired again, and a subject who happened
 * to walk out during finalisation took the whole clip with them — it landed to
 * a closed session and was deleted as unclaimed.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { AppState, mountProvider } from '../testing/mountProvider';
import { useViewfinderState, ViewfinderState } from '../src/state/AppStateContext';
import { notifyDetection } from '../src/surveillance/foregroundService';
import { maxDurationMs, minFreeBytes, postRollMs } from '../src/recording/library';
import { FINALIZE_TIMEOUT_MS } from '../src/recording/useRecorder';
import { DEFAULT_TRACKER_OPTIONS } from '../src/ml/tracker';
import { FrameDetection } from '../src/ml/types';
import { defaultSettings } from '../src/state/defaults';

const NEEDED_BYTES = minFreeBytes(defaultSettings.quality, defaultSettings.max);

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const permission = useCameraPermission as jest.Mock;
const alert = notifyDetection as jest.Mock;

const CAP_MS = maxDurationMs(defaultSettings.max);
const POST_ROLL_MS = postRollMs(defaultSettings.post);
const { dropAfterMs } = DEFAULT_TRACKER_OPTIONS;

/** Analysis runs at a few frames a second; one a second is enough to hold a track. */
const FRAME_MS = 1000;

const person = (x: number): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

/** What `getFSInfo` reports until a test says otherwise. */
function reportFreeSpace(free: number) {
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: free, totalSpace: NEEDED_BYTES * 20, freeSpaceEx: free, totalSpaceEx: NEEDED_BYTES * 20,
  } as never);
}

const SNAPSHOT = '/tmp/novaguard-test/recordings/snap.jpg';

/** Captures VisionCamera's callbacks so a test can land the clip itself. */
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

interface Passage {
  state: AppState;
  viewfinder: ViewfinderState;
  camera: ReturnType<typeof fakeCamera>;
  /** One frame of the subject, nudged along so the tracker keeps the same track. */
  see: () => Promise<void>;
  /** Time passing with the subject in frame. */
  watch: (ms: number) => Promise<void>;
  /** Time passing with an empty room, which is what arms the post-roll. */
  idle: (ms: number) => Promise<void>;
  land: (path: string, duration: number) => Promise<void>;
}

/** Absorbs the storage measurements the provider's own timers kick off. */
async function settle() {
  await ReactTestRenderer.act(async () => {});
}

/**
 * Surveillance running, camera authorised, one confirmed subject in frame.
 *
 * `reportDetections` is called directly rather than through the frame
 * processor: the worklet is compiled away under Jest, and what is under test is
 * the session the callback drives, not how the frame reaches it.
 */
async function passage(): Promise<Passage> {
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });

  const box = {} as { viewfinder: ViewfinderState };
  function ViewfinderProbe() {
    box.viewfinder = useViewfinderState();
    return null;
  }
  const handle = await mountProvider(<ViewfinderProbe />);
  const camera = fakeCamera();
  handle.state.cameraRef.current = camera as never;

  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

  let nudge = 0;
  const see = async () => {
    nudge += 1;
    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([person(0.3 + nudge * 0.001)], 9 / 16);
    });
  };
  /** Advances a frame at a time so the tracker and the timers see the same clock. */
  const run = async (ms: number, frame: () => Promise<void>) => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
      await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(FRAME_MS); });
      await frame();
    }
    await settle();
  };

  // Two frames confirm the track; the third opens the session on it.
  await see();
  await see();
  await see();

  return {
    get state() { return handle.state; },
    get viewfinder() { return box.viewfinder; },
    camera,
    see,
    watch: (ms: number) => run(ms, see),
    idle: (ms: number) => run(ms, async () => {
      await ReactTestRenderer.act(async () => { handle.state.reportDetections([], 9 / 16); });
    }),
    land: async (path: string, duration: number) => {
      await ReactTestRenderer.act(async () => {
        camera.last().onRecordingFinished({ path, duration });
      });
      // `fileSize` and the rename each resolve a tick later.
      await settle();
    },
  };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(false);
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.moveFile.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  // A clip with bytes on disk, so the outcome is "attach" and not "event-only".
  mockFs.stat.mockResolvedValue({ size: 8_000_000 } as never);
  // A volume with room to spare. `free` of 0 means "not measured yet", so a
  // test that left the default would never exercise the space guard at all.
  reportFreeSpace(NEEDED_BYTES * 10);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('opens the next clip itself instead of waiting for the session to be rebuilt', async () => {
  const p = await passage();
  expect(p.camera.startRecording).toHaveBeenCalledTimes(1);

  await p.watch(CAP_MS);
  expect(p.camera.stopRecording).toHaveBeenCalledTimes(1);
  // Landing the clip is what frees the encoder, so that is where the next one
  // starts — not on some later frame, and not after the rename resolves.
  await p.land('/clips/a.mp4', CAP_MS / 1000);

  expect(p.camera.startRecording).toHaveBeenCalledTimes(2);
  expect(p.state.events).toHaveLength(1);
});

it('keeps the session open across the cut', async () => {
  const p = await passage();
  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);

  // The badge names what the *session* is recording. Dropping it mid-passage
  // told the user the subject had gone while the camera was still on them.
  expect(p.state.det).toBe('Personne');
});

it('does not restart the on-screen counter at each clip', async () => {
  const p = await passage();
  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);
  await p.see();

  // The counter measures the passage, which is what a person watching the
  // viewfinder is asking about — "how long has someone been out there".
  expect(p.viewfinder.recSec).toBeGreaterThanOrEqual(CAP_MS / 1000);
});

it('alerts once for the passage, not once per clip', async () => {
  const p = await passage();
  expect(alert).toHaveBeenCalledTimes(1);

  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);
  await p.watch(CAP_MS);
  await p.land('/clips/b.mp4', CAP_MS / 1000);

  // The cooldown is a minute and the cap two, so a session rebuilt at every cut
  // re-armed the alert every time: a phone that buzzes on its own schedule
  // rather than when someone actually arrives.
  expect(alert).toHaveBeenCalledTimes(1);
});

it('files each clip as its own event', async () => {
  const p = await passage();
  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);
  await p.watch(CAP_MS);
  await p.land('/clips/b.mp4', CAP_MS / 1000);

  expect(p.state.events).toHaveLength(2);
  // Both carry a file: a passage split into clips must not lose one of them.
  expect(p.state.events.every(e => e.path != null)).toBe(true);
  expect(p.state.events.every(e => e.bytes === 8_000_000)).toBe(true);
});

/**
 * `dur` normally comes from the encoder, which counts what is in the file. This
 * is the fallback for a clip it reports nothing for — and a fallback measured
 * from the start of the *passage* would claim every later clip contained the
 * whole thing.
 */
it('measures a clip the encoder said nothing about from that clip, not the passage', async () => {
  const p = await passage();
  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);
  await p.watch(CAP_MS);
  await p.land('/clips/b.mp4', 0);

  const [second] = p.state.events;
  expect(second.dur).toBeLessThanOrEqual(CAP_MS / 1000);
  expect(second.dur).toBeGreaterThan(CAP_MS / 2000);
});

/**
 * The window this covers is narrow and entirely real: the post-roll has to be
 * already running when the cap expires, which is any subject who steps out in
 * the last seconds of a clip.
 */
it('keeps the clip when the subject leaves while the cut is still in flight', async () => {
  const p = await passage();

  // Last seen just before the cap, so the post-roll it arms outlives the cut.
  const leaveAt = CAP_MS - POST_ROLL_MS + FRAME_MS;
  // The tracker holds the subject for `dropAfterMs` past the last sighting, and
  // it is the first frame after that which arms the post-roll.
  const dropsAt = leaveAt + Math.ceil((dropAfterMs + 1) / FRAME_MS) * FRAME_MS;
  const sessionEndsAt = dropsAt + POST_ROLL_MS;
  // The window under test: the session closes with the cut still outstanding,
  // but before the recorder has given up on the encoder.
  expect(sessionEndsAt).toBeGreaterThan(CAP_MS);
  expect(sessionEndsAt).toBeLessThan(CAP_MS + FINALIZE_TIMEOUT_MS);

  await p.watch(leaveAt);
  await p.idle(sessionEndsAt + FRAME_MS - leaveAt);

  expect(p.camera.stopRecording).toHaveBeenCalledTimes(1);
  expect(p.state.det).toBeNull();

  await p.land('/clips/a.mp4', CAP_MS / 1000);

  // The old code stopped a second time, read the refusal as "nothing was
  // recording", wrote a file-less event — and then deleted the arriving clip,
  // because by then nothing claimed it.
  expect(p.state.events).toHaveLength(1);
  // Filed under its detection's name, which only the attach path does.
  expect(p.state.events[0].path).toMatch(/\/Personne_[\d-]+_[\d-]+\.mp4$/);
  expect(p.state.events[0].bytes).toBe(8_000_000);
  expect(mockFs.unlink).not.toHaveBeenCalledWith('/clips/a.mp4');
  // And the passage really is over: nothing reopened behind it.
  expect(p.camera.startRecording).toHaveBeenCalledTimes(1);
});

/**
 * The one way a continued passage can lose the rest of its footage silently:
 * the session stays open, and `reportDetections` only starts a recording when
 * it *opens* one — so nothing would ever try again.
 */
/**
 * The other way a cut clip never arrives. A disk that fills mid-clip reports an
 * encoder error rather than handing anything back, so the event the cut was
 * holding would sit in `pendingRef` forever — and the passage would run on with
 * nothing being written.
 */
/**
 * The gap is measured from the two instants the JS side can actually see, and
 * a measurement that quietly read the wrong pair would be worse than none:
 * nobody checks a number the app reports about itself.
 *
 * Fake timers make the encoder's latency whatever this test says it is, which
 * is exactly what a real device will not do — so what is pinned here is that
 * the right interval is being timed, not how long an encoder takes.
 */
describe('measuring the window between two clips', () => {
  /** Lets the encoder take `finalizeMs` to answer the cut, then lands the clip. */
  async function cutTakingMs(p: Awaited<ReturnType<typeof passage>>, finalizeMs: number) {
    await p.watch(CAP_MS);
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(finalizeMs); });
    await p.land('/clips/a.mp4', CAP_MS / 1000);
  }

  it('times the encoder from the cut, not from the clip landing', async () => {
    const p = await passage();
    await cutTakingMs(p, 420);

    expect(p.state.clipGap.samples).toBe(1);
    // Timed from `stopRecording()` to `onRecordingFinished` — the encoder
    // closing the file, which is the half we do not control.
    expect(p.state.clipGap.last!.finalizeMs).toBe(420);
  });

  it('charges the restart to us, and keeps it out of the encoder half', async () => {
    const p = await passage();
    await cutTakingMs(p, 420);

    // Nothing stands between the camera coming free and the next clip opening,
    // so this half is ~0 here. It is the half a stray `stat()` over the bridge
    // was found inflating, which is why it is reported separately at all.
    expect(p.state.clipGap.last!.restartMs).toBe(0);
    expect(p.state.clipGap.worstMs).toBe(420);
  });

  it('measures every cut of a long passage', async () => {
    const p = await passage();
    await cutTakingMs(p, 300);
    await p.watch(CAP_MS);
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(500); });
    await p.land('/clips/b.mp4', CAP_MS / 1000);

    expect(p.state.clipGap.samples).toBe(2);
    expect(p.state.clipGap.worstMs).toBe(500);
  });

  it('records nothing when the passage ends rather than continuing', async () => {
    const p = await passage();
    // A session closed by the post-roll opens no next clip, so there is no gap
    // between two clips to measure — counting it would report a window that
    // never existed.
    await p.watch(2 * FRAME_MS);
    await p.idle(dropAfterMs + POST_ROLL_MS + 2 * FRAME_MS);
    await p.land('/clips/a.mp4', 3);

    expect(p.state.clipGap.samples).toBe(0);
  });

  it('records nothing when the next clip could not be opened', async () => {
    const p = await passage();
    await p.watch(CAP_MS);
    p.camera.startRecording.mockImplementationOnce(() => { throw new Error('camera busy'); });
    await p.land('/clips/a.mp4', CAP_MS / 1000);

    // There is no second clip, so the interval has no end. A gap logged here
    // would be the time until a recording that never started.
    expect(p.state.clipGap.samples).toBe(0);
  });
});

it('still writes the event when the encoder errors on the cut', async () => {
  const p = await passage();
  await p.watch(CAP_MS);

  await ReactTestRenderer.act(async () => {
    p.camera.last().onRecordingError({ message: 'no space left on device' });
  });
  await settle();

  expect(p.state.recError).toBe('no space left on device');
  expect(p.state.events).toHaveLength(1);
  expect(p.state.events[0].path).toBeNull();
  // And the passage is either recording again or closed — never open and idle.
  expect(p.camera.startRecording).toHaveBeenCalledTimes(2);
});

it('closes the session when the next clip cannot be opened', async () => {
  const p = await passage();
  await p.watch(CAP_MS);
  // The encoder refuses the moment it is asked for the next clip.
  p.camera.startRecording.mockImplementationOnce(() => { throw new Error('camera busy'); });
  await p.land('/clips/a.mp4', CAP_MS / 1000);

  expect(p.state.det).toBeNull();
  expect(p.state.recError).toBe('camera busy');

  // Closed, not abandoned: the subject is still tracked, so the next frame
  // opens a fresh session and recording resumes.
  await p.see();
  expect(p.state.det).toBe('Personne');
  expect(p.camera.startRecording).toHaveBeenCalledTimes(3);
});

/**
 * Between the encoder releasing the camera and the next clip starting, nobody
 * is being filmed. Reading the finished clip's size — a round trip over the
 * bridge — used to sit inside that window for no reason: the byte count is
 * needed to file the event, not to start recording again.
 */
it('opens the next clip before reading the finished one back from disk', async () => {
  const p = await passage();
  await p.watch(CAP_MS);

  // A `stat()` this test resolves by hand, standing in for a slow bridge.
  let finishStat!: (info: unknown) => void;
  mockFs.stat.mockReturnValueOnce(new Promise(resolve => { finishStat = resolve; }) as never);

  await ReactTestRenderer.act(async () => {
    p.camera.last().onRecordingFinished({ path: '/clips/a.mp4', duration: CAP_MS / 1000 });
  });

  // Recording again already, with the size still outstanding.
  expect(p.camera.startRecording).toHaveBeenCalledTimes(2);
  expect(p.state.events).toHaveLength(0);

  await ReactTestRenderer.act(async () => { finishStat({ size: 8_000_000 }); });
  await settle();
  expect(p.state.events).toHaveLength(1);
  expect(p.state.events[0].bytes).toBe(8_000_000);
});

/**
 * The guard that refuses to record on a nearly full volume ran only when a
 * session *opened*. Making the session survive the duration cap therefore took
 * it out of long passages entirely — the very recordings most able to fill a
 * disk.
 */
it('refuses to open the next clip once the volume has filled up', async () => {
  const p = await passage();
  // Not enough for another clip. The sweep re-measures every DISK_SWEEP_MS, so
  // the passage itself carries the new figure into the provider.
  reportFreeSpace(NEEDED_BYTES - 1);
  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);

  expect(p.camera.startRecording).toHaveBeenCalledTimes(1);
  expect(p.state.recError).toBe('Espace insuffisant pour enregistrer');
  // The clip that was already written is still filed — refusing the next one
  // must not cost the one just finished.
  expect(p.state.events).toHaveLength(1);
  expect(p.state.events[0].path).toMatch(/\/Personne_[\d-]+_[\d-]+\.mp4$/);
});

it('keeps rolling while there is room for another clip', async () => {
  const p = await passage();
  // One byte the other side of the same line: without this the test above
  // would pass on a guard that simply refused everything.
  reportFreeSpace(NEEDED_BYTES);
  await p.watch(CAP_MS);
  await p.land('/clips/a.mp4', CAP_MS / 1000);

  expect(p.camera.startRecording).toHaveBeenCalledTimes(2);
  expect(p.state.recError).toBeNull();
});

it('still writes the event when the encoder never answers the cut', async () => {
  const p = await passage();
  await p.watch(CAP_MS);

  // No `onRecordingFinished` at all. The recorder gives up after
  // FINALIZE_TIMEOUT_MS so the camera can be released — and nothing else would
  // ever write the event the abandoned clip was carrying.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(FINALIZE_TIMEOUT_MS);
  });
  await settle();

  expect(p.state.events).toHaveLength(1);
  expect(p.state.events[0].path).toBeNull();
  // The subject is still there, so the passage carries on in a new clip.
  expect(p.camera.startRecording).toHaveBeenCalledTimes(2);
});
