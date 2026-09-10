/**
 * Starting surveillance is gated on the camera permission.
 *
 * Without the gate this took the whole app down on a real device: the
 * foreground service claims the `camera` type, Android requires the permission
 * to be held at that instant, and the SecurityException is raised inside the
 * service — a stack no caller can wrap in a try/catch.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import { useCameraPermission } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RESUME_ARM_MS } from '../src/state/AppStateContext';
import { AppState, mountProvider } from '../testing/mountProvider';
import { startForegroundService } from '../src/surveillance/foregroundService';

jest.mock('../src/surveillance/foregroundService');

const permission = useCameraPermission as jest.Mock;
const startService = startForegroundService as jest.Mock;

async function mount() {
  return mountProvider();
}

const requestPermission = jest.fn();

beforeEach(async () => {
  // The provider runs a 1 s clock; on real timers it fires throughout the test
  // and buries the output in act() warnings.
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // The real hook always returns a promise; default to a refusal so tests that
  // do not care about the prompt still exercise a realistic shape.
  requestPermission.mockResolvedValue(false);
  permission.mockReturnValue({ hasPermission: false, requestPermission });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('refuses to start without the camera permission, and asks for it', async () => {
  const box = await mount();
  ReactTestRenderer.act(() => { box.state.toggleMonitoring(); });

  expect(box.state.monitoring).toBe(false);
  expect(requestPermission).toHaveBeenCalled();
  expect(startService).not.toHaveBeenCalled();
  expect(box.state.recError).toBe('Autorisez la caméra pour démarrer la surveillance');
});

it('starts once the permission is held', async () => {
  permission.mockReturnValue({ hasPermission: true, requestPermission });
  const box = await mount();
  ReactTestRenderer.act(() => { box.state.toggleMonitoring(); });

  expect(box.state.monitoring).toBe(true);
  expect(box.state.recError).toBeNull();
  expect(startService).toHaveBeenCalled();
});

it('stops again without needing any permission', async () => {
  permission.mockReturnValue({ hasPermission: true, requestPermission });
  const box = await mount();
  ReactTestRenderer.act(() => { box.state.toggleMonitoring(); });
  ReactTestRenderer.act(() => { box.state.toggleMonitoring(); });

  expect(box.state.monitoring).toBe(false);
});

describe('remembering that surveillance was on', () => {
  const stored = () => AsyncStorage.getItem('@novaguard:monitoring');

  beforeEach(() => {
    permission.mockReturnValue({ hasPermission: true, requestPermission });
  });

  /** What the frame processor calls once the camera is really running. */
  const deliverFrame = (box: { state: { reportDetections: AppState['reportDetections'] } }) =>
    ReactTestRenderer.act(() => { box.state.reportDetections([], 9 / 16); });

  it('does not remember a start that has not survived yet', async () => {
    // The trap this avoids: a crash during startup persists "on", the next
    // launch auto-resumes because of it, and the app dies again before anyone
    // can reach the setting that would stop it.
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await deliverFrame(box);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(RESUME_ARM_MS - 500);
    });
    await expect(stored()).resolves.not.toBe('true');
  });

  it('never arms a session the camera never delivered a frame for', async () => {
    // A start that dies before its first frame — no device, a refused model, a
    // worklet that throws — must not ask to be replayed at the next launch. The
    // countdown used to run on wall-clock time alone, so it armed anyway.
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(RESUME_ARM_MS * 2);
    });
    // The periodic disk sweep rides the same clock; let it settle.
    await ReactTestRenderer.act(async () => {});
    await expect(stored()).resolves.not.toBe('true');
  });

  it('remembers it once it has run long enough to be worth resuming', async () => {
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await deliverFrame(box);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(RESUME_ARM_MS + 100);
    });
    await expect(stored()).resolves.toBe('true');
  });

  it('counts from the first frame, not from the tap', async () => {
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    // The camera takes a while to come up; that time must not count.
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(RESUME_ARM_MS - 200);
    });
    await deliverFrame(box);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(RESUME_ARM_MS - 200);
    });
    await expect(stored()).resolves.not.toBe('true');

    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(400); });
    await expect(stored()).resolves.toBe('true');
  });

  it('forgets it immediately when surveillance is stopped', async () => {
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await deliverFrame(box);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(RESUME_ARM_MS + 100);
    });
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => {});
    await expect(stored()).resolves.toBe('false');
  });

  it('makes a restarted session earn its arming again', async () => {
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await deliverFrame(box);
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(RESUME_ARM_MS + 100); });
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => {});

    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(RESUME_ARM_MS * 2); });
    await ReactTestRenderer.act(async () => {});
    await expect(stored()).resolves.toBe('false');
  });
});

describe('granting the permission from the button', () => {
  it('starts as soon as the user says yes, instead of dead-ending', async () => {
    requestPermission.mockResolvedValue(true);
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => {});

    expect(box.state.monitoring).toBe(true);
    expect(box.state.recError).toBeNull();
  });

  it('stays put and keeps the message if the user says no', async () => {
    requestPermission.mockResolvedValue(false);
    const box = await mount();
    await ReactTestRenderer.act(async () => { box.state.toggleMonitoring(); });
    await ReactTestRenderer.act(async () => {});

    expect(box.state.monitoring).toBe(false);
    expect(box.state.recError).toBe('Autorisez la caméra pour démarrer la surveillance');
  });
});
