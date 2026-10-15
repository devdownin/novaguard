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


const at = (x: number): FrameDetection => ({ ...person, box: { ...person.box, x } });

it('files where the subject was, a sample a second, with the clip it belongs to', async () => {
  const h = await watch();
  for (let i = 0; i <= 12; i++) await frame(h, i * 250, [at(0.1 + i * 0.02)]);
  await clip(false);
  const [event] = h.state.events;
  expect(event.path).toBeTruthy();
  expect(event.subject).toBeDefined();
  const subject = event.subject!;
  // One sample a second, not one per look, counted from the clip's start —
  // which reaches back to the first sighting, a look before confirmation.
  expect(subject.map(s => s.t)).toEqual([250, 1250, 2250]);
  expect(subject[0]).toEqual({ t: 250, x: 0.12, y: 0.2, w: 0.2, h: 0.5 });
  expect(subject[2].x).toBeCloseTo(0.28, 3);
});

it('files no trail on an event that has no clip', async () => {
  const h = await watch();
  for (let i = 0; i <= 4; i++) await frame(h, i * 250, [person]);
  await ReactTestRenderer.act(async () => {
    for (const listener of mockListeners) listener({ recordingId: currentId(), path: '/clips/A.mp4', bytes: 0,
      thumbPath: null, duration: 0, startedAt: T0, endedAt: T0 + 500, continued: false });
  });
  await ReactTestRenderer.act(async () => {});
  expect(h.state.events[0]?.path ?? null).toBeNull();
  expect(h.state.events[0]?.subject).toBeUndefined();
});
