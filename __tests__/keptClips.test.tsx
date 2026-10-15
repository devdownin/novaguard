/**
 * A clip held as evidence outlives every automatic deletion, and only that.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from '@dr.pogodin/react-native-fs';
import { useCameraPermission } from 'react-native-vision-camera';
import { mountProvider } from '../testing/mountProvider';
import { defaultSettings } from '../src/state/defaults';
import { DetectionEvent } from '../src/state/types';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const DAY = 86_400_000;
const clip = (id: number, at: number, extra: Partial<DetectionEvent> = {}): DetectionEvent => ({
  id, kind: 'Personne', timestamp: at, dur: 4, conf: 90, path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null, ...extra,
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  mockFs.getFSInfo.mockResolvedValue({ freeSpace: 8e10, totalSpace: 1e11 } as never);
  mockFs.exists.mockResolvedValue(true);
  mockFs.unlink.mockResolvedValue(undefined);
});
afterEach(() => { jest.useRealTimers(); });

it('spares a kept passage, all its segments, from the retention sweep', async () => {
  const old = Date.now() - 30 * DAY;
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({ ...defaultSettings, retention: '7 jours' }));
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
    clip(3, old + 2000), clip(2, old + 1000, { passageId: 'p' }), clip(1, old, { passageId: 'p', kept: true }),
  ]));
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => {});
  expect(handle.state.events.map(e => e.id).sort()).toEqual([1, 2]);
  expect(mockFs.unlink).toHaveBeenCalledWith('/c/3.mp4');
  expect(mockFs.unlink).not.toHaveBeenCalledWith('/c/1.mp4');
  expect(mockFs.unlink).not.toHaveBeenCalledWith('/c/2.mp4');
});

it('keeps and releases the whole selected passage, and writes it to disk', async () => {
  const now = Date.now();
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
    clip(3, now - 5000), clip(2, now - 1000, { passageId: 'p' }), clip(1, now - 2000, { passageId: 'p' }),
  ]));
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.selectEvent(2); });
  await ReactTestRenderer.act(async () => { handle.state.toggleKeep(); });
  const kept = () => handle.state.events.filter(e => e.kept).map(e => e.id).sort();
  expect(kept()).toEqual([1, 2]);
  const saved: DetectionEvent[] = JSON.parse((await AsyncStorage.getItem('@novaguard:events:v2'))!);
  expect(saved.filter(e => e.kept).map(e => e.id).sort()).toEqual([1, 2]);
  await ReactTestRenderer.act(async () => { handle.state.toggleKeep(); });
  expect(kept()).toEqual([]);
});
