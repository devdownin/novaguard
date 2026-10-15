import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { AppState, mountProvider } from '../testing/mountProvider';
import { FrameDetection } from '../src/ml/types';

const mockListeners = new Set<(clip: unknown) => void>();
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({ __esModule: true, default: class {
  addListener(_name: string, listener: (clip: unknown) => void) {
    mockListeners.add(listener);
    return { remove: () => mockListeners.delete(listener) };
  }
} }));
jest.mock('../src/surveillance/foregroundService');
const native = {
  startCapture: jest.fn(async () => {}), stopCapture: jest.fn(async () => {}),
  begin: jest.fn(async (_id: number, _fromAt: number, _maxMs: number) => {}), observe: jest.fn(), end: jest.fn(async () => {}),
  addListener: jest.fn(), removeListeners: jest.fn(),
};
const currentId = () => native.begin.mock.calls.at(-1)![0];
const T0 = 1_780_000_000_000;
const person: FrameDetection = { kind: 'Personne', confidence: 0.9, box: { x: 0.2, y: 0.2, width: 0.2, height: 0.5 } };
const dog: FrameDetection = { kind: 'Animal', confidence: 0.85, box: { x: 0.7, y: 0.5, width: 0.2, height: 0.2 } };
const mockFs = fs as jest.Mocked<typeof fs>;

beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(T0); jest.clearAllMocks(); mockListeners.clear();
  await AsyncStorage.clear();
  NativeModules.PresenceRecorder = native;
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  mockFs.exists.mockResolvedValue(false); mockFs.moveFile.mockResolvedValue(undefined);
});
afterEach(() => { jest.useRealTimers(); });
async function watch() {
  const h = await mountProvider();
  await ReactTestRenderer.act(async () => { h.state.toggleMonitoring(); });
  return h;
}
async function frame(h: { state: AppState }, offset: number, detections: FrameDetection[]) {
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(Math.max(0, T0 + offset + 40 - Date.now())); // delivery is later than capture
    h.state.reportDetections(detections, 9 / 16, T0 + offset);
  });
}
async function clip(continued: boolean, path = '/clips/A.mp4') {
  await ReactTestRenderer.act(async () => {
    for (const listener of mockListeners) listener({ recordingId: currentId(), path, bytes: 1024,
      thumbPath: null, duration: 0.5, startedAt: T0, endedAt: T0 + 500, continued });
  });
  await ReactTestRenderer.act(async () => {});
}

it('defaults to strict presence and warms the native buffer without writing an empty scene', async () => {
  const h = await watch();
  expect(h.state.settings.post).toBe('0 s');
  expect(native.startCapture).toHaveBeenCalled();
  await frame(h, 0, []);
  expect(native.begin).not.toHaveBeenCalled();
});

it('joins a brief missed detection in tolerant mode without restarting the clip', async () => {
  const h = await watch();
  await ReactTestRenderer.act(async () => { h.state.setPresenceMode('tolerant'); });
  expect(h.state.settings.post).toBe('1 s');
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  await frame(h, 666, []); await frame(h, 900, [person]);
  expect(native.begin).toHaveBeenCalledTimes(1);
  expect(native.end).not.toHaveBeenCalled();
  await frame(h, 1233, []);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
  expect(native.end).toHaveBeenCalledWith(currentId(), T0 + 1900);
});

it('retains the chosen tolerance when switching back to strict and ends an open clip safely', async () => {
  const h = await watch();
  await ReactTestRenderer.act(async () => { h.state.setPresenceMode('tolerant'); });
  await ReactTestRenderer.act(async () => { h.state.cycleTolerance(); });
  expect(h.state.settings.post).toBe('2 s');
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  await ReactTestRenderer.act(async () => { h.state.setPresenceMode('strict'); });
  expect(native.end).toHaveBeenCalledWith(currentId(), T0 + 333);
  expect(h.state.settings.post).toBe('0 s');
  await ReactTestRenderer.act(async () => { h.state.setPresenceMode('tolerant'); });
  expect(h.state.settings.post).toBe('2 s');
  const stored = JSON.parse((await AsyncStorage.getItem('@novaguard:settings'))!);
  expect(stored.post).toBe('2 s');
  expect(stored.tolerance).toBe('2 s');
  await frame(h, 666, [person]);
  expect(native.begin).toHaveBeenLastCalledWith(expect.any(Number), T0 + 666, 120_000);
});

it('reports stalled analysis instead of an empty scene and recovers on a new analysed frame', async () => {
  const h = await watch();
  await frame(h, 0, []);
  expect(h.state.surveillanceStatus).toBe('active');
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(4000); });
  expect(h.state.surveillanceStatus).toBe('analysis-unavailable');
  expect(h.state.recError).toContain('sans réponse');
  await frame(h, 4333, []);
  expect(h.state.surveillanceStatus).toBe('active');
  expect(h.state.recError).toBeNull();
});

it('splits a tolerant passage when the subject returns after the selected margin', async () => {
  const h = await watch();
  await ReactTestRenderer.act(async () => { h.state.setPresenceMode('tolerant'); });
  await frame(h, 0, [person]); await frame(h, 333, [person]); await frame(h, 666, []);
  const firstId = currentId();
  await frame(h, 1600, [person]);
  expect(native.end).toHaveBeenCalledWith(firstId, T0 + 1333);
  expect(native.begin).toHaveBeenCalledTimes(2);
  expect(currentId()).not.toBe(firstId);
});

it('exposes capture faults until a successful retry and never clears an analysis fault with a recording start', async () => {
  native.begin.mockRejectedValueOnce(new Error('codec busy'));
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  expect(h.state.surveillanceStatus).toBe('recording-error');
  await ReactTestRenderer.act(async () => { h.state.reportCameraProblem('Modèle indisponible'); });
  await frame(h, 1400, [person]);
  expect(h.state.surveillanceStatus).toBe('analysis-unavailable');
  await ReactTestRenderer.act(async () => { h.state.reportCameraProblem(null); });
  expect(h.state.surveillanceStatus).toBe('recording');
});
it('recovers from the first sighting, before confirmation, and closes at the last positive capture', async () => {
  const h = await watch();
  await frame(h, 0, [person]);
  expect(native.begin).not.toHaveBeenCalled();
  await frame(h, 333, [person]);
  expect(native.begin).toHaveBeenCalledWith(expect.any(Number), T0, 120_000);
  await frame(h, 666, []);
  expect(native.end).not.toHaveBeenCalled();
  await frame(h, 1600, []);
  // The tracker's grace decides when the subject is gone, never where the file ends.
  expect(native.end).toHaveBeenCalledWith(currentId(), T0 + 333);
  expect(h.state.det).toBeNull();
  await clip(false);
  expect(h.state.events).toHaveLength(1);
  expect(h.state.events[0].path).not.toBeNull();
});
it('continues until the last of several persons or animals disappears', async () => {
  const h = await watch();
  await frame(h, 0, [person, dog]); await frame(h, 333, [person, dog]);
  await frame(h, 666, [dog]);
  expect(native.end).not.toHaveBeenCalled();
  expect(native.observe).toHaveBeenLastCalledWith(currentId(), T0 + 666);
  await frame(h, 999, []);
  expect(native.end).not.toHaveBeenCalled();
  await frame(h, 2000, []);
  expect(native.end).toHaveBeenCalledWith(currentId(), T0 + 666);
});
it('files native segments without restarting or stopping the encoder', async () => {
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  await clip(true); await clip(true, '/clips/B.mp4');
  expect(h.state.events).toHaveLength(2);
  expect(native.begin).toHaveBeenCalledTimes(1);
  expect(native.end).not.toHaveBeenCalled();
  expect(h.state.det).toBe('Personne');
});
it('retries an asynchronous native start failure with the presence still visible', async () => {
  native.begin.mockRejectedValueOnce(new Error('warming up'));
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  await frame(h, 1400, [person]);
  expect(native.begin).toHaveBeenCalledTimes(2);
});
it('bridges a missed look while the tracker still holds the subject, in one recording', async () => {
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  await frame(h, 666, []);
  await frame(h, 900, [person]);
  expect(native.end).not.toHaveBeenCalled();
  expect(native.begin).toHaveBeenCalledTimes(1);
  expect(native.observe).toHaveBeenLastCalledWith(currentId(), T0 + 900);
  expect(h.state.det).toBe('Personne');
});
it('does not include an absence once the tracker has let the subject go', async () => {
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  const firstId = currentId();
  await frame(h, 666, []); await frame(h, 1600, []);
  expect(native.end).toHaveBeenCalledWith(firstId, T0 + 333);
  await clip(false);
  await frame(h, 2000, [person]); await frame(h, 2333, [person]);
  expect(native.begin).toHaveBeenLastCalledWith(expect.any(Number), T0 + 2000, 120_000);
  expect(currentId()).not.toBe(firstId);
});
it('ignores residual detections after the user stops surveillance', async () => {
  const h = await watch();
  await ReactTestRenderer.act(async () => { h.state.toggleMonitoring(); });
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  expect(native.begin).not.toHaveBeenCalled();
});

it('retries a transient capture preparation failure while surveillance remains enabled', async () => {
  native.startCapture.mockRejectedValueOnce(new Error('microphone busy'));
  const h = await watch();
  expect(native.startCapture).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
  expect(native.startCapture).toHaveBeenCalledTimes(2);
  await frame(h, 1100, [person]); await frame(h, 1433, [person]);
  expect(native.begin).toHaveBeenCalled();
});

it('keeps retry delays bounded when the wall clock moves backwards', async () => {
  native.begin.mockRejectedValueOnce(new Error('busy'));
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  await ReactTestRenderer.act(async () => {
    jest.setSystemTime(T0 - 60_000);
    jest.advanceTimersByTime(1000);
    h.state.reportDetections([person], 9 / 16, T0 + 1333);
  });
  expect(native.begin).toHaveBeenCalledTimes(2);
});

it('opens the next presence while the previous file is still finalising', async () => {
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  const firstId = currentId();
  await frame(h, 666, []); await frame(h, 1600, []);
  await frame(h, 1700, [person]); await frame(h, 2000, [person]);
  const secondId = currentId();
  expect(secondId).not.toBe(firstId);
  expect(native.begin).toHaveBeenCalledTimes(2);
  await ReactTestRenderer.act(async () => {
    for (const listener of mockListeners) listener({ recordingId: firstId, path: '/clips/old.mp4', bytes: 1024,
      thumbPath: null, duration: 0.3, startedAt: T0, endedAt: T0 + 333, continued: false });
  });
  expect(h.state.recording).toBe(true);
  expect(h.state.det).toBe('Personne');
  expect(h.state.events).toHaveLength(1);
});

it('keeps a partial clip after an encoder error without settling the replacement recording', async () => {
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  const firstId = currentId();
  await ReactTestRenderer.act(async () => {
    for (const listener of mockListeners) listener({ recordingId: firstId, error: 'encoder error', encoderFree: true });
  });
  await frame(h, 666, [person]);
  expect(currentId()).not.toBe(firstId);
  await ReactTestRenderer.act(async () => {
    for (const listener of mockListeners) listener({ recordingId: firstId, path: '/clips/partial.mp4', bytes: 1024,
      thumbPath: null, duration: 0.3, startedAt: T0, endedAt: T0 + 333, continued: false, warning: 'encoder error' });
  });
  expect(h.state.events).toHaveLength(1);
  expect(h.state.events[0].path).not.toBeNull();
  expect(h.state.recording).toBe(true);
  expect(native.begin).toHaveBeenCalledTimes(2);
});

it('persists one passage identity across native segments and a different one for a new presence', async () => {
  const h = await watch();
  await frame(h, 0, [person, dog]); await frame(h, 333, [person, dog]);
  await clip(true); await clip(true, '/clips/B.mp4');
  const first = h.state.events[0].passageId;
  expect(first).toBeTruthy();
  expect(h.state.events[1].passageId).toBe(first);
  expect(h.state.events[0].kinds).toEqual(['Personne', 'Animal']);
  await frame(h, 666, []); await frame(h, 1600, []); await clip(false, '/clips/C.mp4');
  await frame(h, 2000, [person]); await frame(h, 2333, [person]);
  await clip(true, '/clips/D.mp4');
  expect(h.state.events[0].passageId).not.toBe(first);
  const saved = JSON.parse((await AsyncStorage.getItem('@novaguard:events:v2'))!);
  expect(saved[0].passageId).toBe(h.state.events[0].passageId);
});

it('does not let an old recording error overwrite a successful explicit restart', async () => {
  const h = await watch();
  await frame(h, 0, [person]); await frame(h, 333, [person]);
  const old = currentId();
  await ReactTestRenderer.act(async () => { h.state.retryCapture(); });
  await ReactTestRenderer.act(async () => {
    for (const listener of mockListeners) listener({ recordingId: old, error: 'old codec error', encoderFree: true });
    for (const listener of mockListeners) listener({ recordingId: old, error: 'old codec error' });
  });
  await frame(h, 666, []);
  expect(h.state.surveillanceStatus).toBe('active');
  expect(h.state.recError).toBeNull();
  expect(h.state.events.some(event => event.path === null)).toBe(true);
});
