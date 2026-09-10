/**
 * What happens when the camera is taken away mid-watch.
 *
 * An incoming call, another app opening the camera, an OEM policy reclaiming
 * it: CameraX hands back an error and stops delivering. The whole response used
 * to be a line of text in the corner of the viewfinder — drawn on the one
 * screen a surveillance phone keeps switched off. The service notification went
 * on saying "surveillance active", the status pill went on saying it, nothing
 * was being filmed, and nothing tried again.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { mountProvider } from '../testing/mountProvider';
import { NOTIFICATION_BODY, startForegroundService } from '../src/surveillance/foregroundService';
import { retryDelayFor } from '../src/camera/cameraHealth';
import { FrameDetection } from '../src/ml/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const permission = useCameraPermission as jest.Mock;
const startService = startForegroundService as jest.Mock;

const FAILURE = 'Camera session error [session/camera-has-been-disconnected]';

async function watching() {
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  await ReactTestRenderer.act(async () => {});
  return handle;
}

/** What the notification says right now, as the service was last told. */
function notificationBody() {
  const calls = startService.mock.calls;
  return calls.length === 0 ? null : calls[calls.length - 1][0] ?? NOTIFICATION_BODY;
}

const person = (): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.5 } });

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(false);
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: 8e10, totalSpace: 1e11, freeSpaceEx: 8e10, totalSpaceEx: 1e11,
  } as never);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('says the camera is down on the surface a dark screen still shows', async () => {
  const handle = await watching();
  expect(notificationBody()).toBe(NOTIFICATION_BODY);

  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });

  // The notification is the only thing a propped-up phone displays. Leaving it
  // on "surveillance active" is the app asserting something false.
  expect(notificationBody()).toBe(t('notif.interrupted'));
  expect(handle.state.cameraHealth).toBe('interrupted');
  expect(handle.state.recError).toBe(FAILURE);
});

it('drops the dead session and takes the camera back', async () => {
  const handle = await watching();

  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });
  // Unmounted: that is what lets CameraX hand the device back and take it again.
  expect(handle.state.cameraActive).toBe(false);

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(retryDelayFor(0)); });
  expect(handle.state.cameraActive).toBe(true);
  // Still interrupted: mounting a session proves nothing on its own.
  expect(handle.state.cameraHealth).toBe('interrupted');
});

it('waits longer after each failed attempt, and never stops trying', async () => {
  const handle = await watching();
  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(retryDelayFor(0)); });

  // The restarted session dies again, as it does while another app holds the
  // camera. The next attempt must not come at the same rate.
  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });
  expect(handle.state.cameraActive).toBe(false);

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(retryDelayFor(0)); });
  expect(handle.state.cameraActive).toBe(false);

  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(retryDelayFor(1) - retryDelayFor(0));
  });
  expect(handle.state.cameraActive).toBe(true);
});

it('is well again on a frame, not on a restart', async () => {
  const handle = await watching();
  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(retryDelayFor(0)); });
  expect(handle.state.cameraHealth).toBe('interrupted');

  await ReactTestRenderer.act(async () => { handle.state.reportDetections([person()], 9 / 16); });

  expect(handle.state.cameraHealth).toBe('healthy');
  // And the notification stops warning about an interruption that is over.
  expect(notificationBody()).toBe(NOTIFICATION_BODY);
});

it('restarts nothing when surveillance is not running', async () => {
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  const handle = await mountProvider();

  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });

  // The message is the whole answer here: there is no session to bring back,
  // and a restart loop against a camera nobody asked for is battery spent on
  // nothing.
  expect(handle.state.recError).toBe(FAILURE);
  expect(handle.state.cameraHealth).toBe('healthy');
  expect(handle.state.cameraActive).toBe(true);
});

it('forgets the interruption when surveillance is stopped and started again', async () => {
  const handle = await watching();
  await ReactTestRenderer.act(async () => { handle.state.reportCameraError(FAILURE); });

  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  expect(handle.state.cameraHealth).toBe('healthy');
  expect(handle.state.cameraActive).toBe(true);
});
