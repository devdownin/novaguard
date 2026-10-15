/**
 * A tap on a detection alert lands on its passage.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import * as fs from '@dr.pogodin/react-native-fs';
import { useCameraPermission } from 'react-native-vision-camera';
import { mountProvider } from '../testing/mountProvider';
import { DetectionEvent } from '../src/state/types';
import { notifyDetection } from '../src/surveillance/foregroundService';
import { passageIdFromUrl } from '../src/surveillance/alerts';
import { FrameDetection } from '../src/ml/types';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const getInitialURL = Linking.getInitialURL as jest.Mock;
const addEventListener = Linking.addEventListener as jest.Mock;
const clip = (id: number, at: number, passageId?: string): DetectionEvent => ({
  id, kind: 'Personne', timestamp: at, dur: 4, conf: 90, path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null, passageId,
});
const person: FrameDetection = { kind: 'Personne', confidence: 0.9, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.5 } };

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  mockFs.getFSInfo.mockResolvedValue({ freeSpace: 8e10, totalSpace: 1e11 } as never);
  getInitialURL.mockResolvedValue(null);
  addEventListener.mockReturnValue({ remove: jest.fn() });
  const now = Date.now();
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
    clip(3, now - 9000), clip(2, now - 1000, 'p'), clip(1, now - 2000, 'p'),
  ]));
});
afterEach(() => { jest.useRealTimers(); });

it('opens the latest clip of the passage when the app is launched from the alert', async () => {
  getInitialURL.mockResolvedValue('novaguard://passage/p');
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => {});
  expect(handle.state.tab).toBe('hist');
  expect(handle.state.selected).toBe(2);
});

it('opens it when the alert is tapped with the app already running', async () => {
  const handle = await mountProvider();
  expect(handle.state.tab).toBe('cam');
  const listener = addEventListener.mock.calls.find(([name]) => name === 'url')![1];
  await ReactTestRenderer.act(async () => { listener({ url: 'novaguard://passage/p' }); });
  expect(handle.state.tab).toBe('hist');
  expect(handle.state.selected).toBe(2);
});

it('ignores a link that is not a passage', async () => {
  getInitialURL.mockResolvedValue('https://example.org/');
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => {});
  expect(handle.state.tab).toBe('cam');
  expect(handle.state.selected).toBeNull();
});

it('hands the alert the passage it opened, so the link can find it later', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  await ReactTestRenderer.act(async () => {
    handle.state.reportDetections([person], 9 / 16);
    handle.state.reportDetections([person], 9 / 16);
  });
  const [, , passageId] = (notifyDetection as jest.Mock).mock.calls.at(-1)!;
  expect(passageId).toMatch(/\S/);
  expect(passageIdFromUrl(`novaguard://passage/${encodeURIComponent(passageId)}`)).toBe(passageId);
});
