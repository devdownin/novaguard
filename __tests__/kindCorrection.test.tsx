/**
 * A subject the detector reads two ways.
 *
 * EfficientDet returns one label per box, and it changes its mind about exactly
 * the subjects a surveillance camera is pointed at: someone at the end of a
 * garden, crouching or half-lit, comes back as a dog for a look or two before
 * coming back as a person for the next twenty. The track was opened on the
 * first of those looks and kept its label for life, so the passage was filmed
 * as an "Animal" — in the badge, in the clip's own name and in the history
 * entry, which is the only one of the three that is still there tomorrow.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { mountProvider } from '../testing/mountProvider';
import { postRollMs } from '../src/recording/library';
import { DetectionKind } from '../src/state/types';
import { FrameDetection } from '../src/ml/types';
import { defaultSettings } from '../src/state/defaults';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const permission = useCameraPermission as jest.Mock;

const POST_ROLL_MS = postRollMs(defaultSettings.post);
const FRAME_MS = 1000;

/** The same subject, in the same place, read as one kind or the other. */
const seenAs = (kind: DetectionKind, confidence: number): FrameDetection =>
  ({ kind, confidence, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.5 } });

async function watching() {
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  const handle = await mountProvider();
  const calls: { onRecordingFinished: Function }[] = [];
  handle.state.cameraRef.current = {
    startRecording: jest.fn(opts => calls.push(opts)),
    stopRecording: jest.fn(),
    takeSnapshot: jest.fn(async () => ({ path: '/tmp/novaguard-test/recordings/snap.jpg' })),
  } as never;

  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  // The provider's own disk measurement resolves a tick later; let it land
  // inside `act` rather than during whatever assertion happens to follow.
  await ReactTestRenderer.act(async () => {});

  const look = async (kind: DetectionKind, confidence: number) => {
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(FRAME_MS); });
    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([seenAs(kind, confidence)], 9 / 16);
    });
    // The storage measurement the provider's timer kicked off resolves here.
    await ReactTestRenderer.act(async () => {});
  };

  /** The subject leaves, the post-roll runs out, and the clip lands. */
  const leave = async () => {
    for (let elapsed = 0; elapsed <= POST_ROLL_MS; elapsed += FRAME_MS) {
      await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(FRAME_MS); });
      await ReactTestRenderer.act(async () => { handle.state.reportDetections([], 9 / 16); });
      await ReactTestRenderer.act(async () => {});
    }
    await ReactTestRenderer.act(async () => {
      calls[calls.length - 1].onRecordingFinished({ path: '/clips/a.mp4', duration: 12 });
    });
    await ReactTestRenderer.act(async () => {});
  };

  return { handle, look, leave };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(false);
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.moveFile.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  mockFs.stat.mockResolvedValue({ size: 8_000_000 } as never);
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: 8e10, totalSpace: 1e11, freeSpaceEx: 8e10, totalSpaceEx: 1e11,
  } as never);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('corrects the badge when the looks stop agreeing with the first one', async () => {
  const w = await watching();
  await w.look('Animal', 0.62);
  await w.look('Animal', 0.61);
  expect(w.handle.state.det).toBe('Animal');

  await w.look('Personne', 0.9);
  await w.look('Personne', 0.92);

  expect(w.handle.state.det).toBe('Personne');
});

it('writes the corrected label to the history, not the one the session opened on', async () => {
  const w = await watching();
  await w.look('Animal', 0.62);
  await w.look('Animal', 0.61);
  await w.look('Personne', 0.9);
  await w.look('Personne', 0.92);
  await w.leave();

  expect(w.handle.state.events).toHaveLength(1);
  expect(w.handle.state.events[0].kind).toBe('Personne');
});

it('leaves the session on its own subject when another kind walks in', async () => {
  const w = await watching();
  await w.look('Personne', 0.9);
  await w.look('Personne', 0.9);

  // A second subject, elsewhere in the frame and more confident: it becomes the
  // primary track on its own merits, but it is not the one being filmed.
  const dog = { kind: 'Animal' as DetectionKind, confidence: 0.98,
    box: { x: 0.7, y: 0.3, width: 0.2, height: 0.5 } };
  for (let i = 0; i < 3; i++) {
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(FRAME_MS); });
    await ReactTestRenderer.act(async () => {
      w.handle.state.reportDetections([seenAs('Personne', 0.9), dog], 9 / 16);
    });
    await ReactTestRenderer.act(async () => {});
  }
  await w.leave();

  expect(w.handle.state.events[0].kind).toBe('Personne');
});
