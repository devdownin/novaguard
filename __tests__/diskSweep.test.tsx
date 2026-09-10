/**
 * Free space is measured on its own cadence, not on the library's.
 *
 * It used to ride the `events` array: every detection committed an event, which
 * re-ran the effect, which called `getFSInfo` — a native round trip, hundreds
 * of them over a night, for a number that only moves as clips are written.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from '@dr.pogodin/react-native-fs';
import { DISK_SWEEP_MS } from '../src/state/AppStateContext';
import { mountProvider } from '../testing/mountProvider';
import { defaultSettings } from '../src/state/defaults';
import { LOW_SPACE_BYTES } from '../src/recording/library';
import { FrameDetection } from '../src/ml/types';
import { DEFAULT_TRACKER_OPTIONS } from '../src/ml/tracker';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const GB = 1024 * 1024 * 1024;

const person = (x: number): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

function reportSpace(free: number) {
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: free, totalSpace: 64 * GB, freeSpaceEx: free, totalSpaceEx: 64 * GB,
  } as never);
}

/** Drives one full detection session, which commits a history event. */
async function oneSession(report: (d: FrameDetection[], a: number) => void) {
  await ReactTestRenderer.act(async () => {
    report([person(0.3)], 9 / 16);
    report([person(0.31)], 9 / 16);
  });
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(DEFAULT_TRACKER_OPTIONS.dropAfterMs + 100);
    report([], 9 / 16);
  });
  // Past the default 10 s post-roll, which is what closes the session.
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(11_000); });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(false);
  mockFs.readDir.mockResolvedValue([] as never);
  reportSpace(20 * GB);
});

afterEach(() => {
  jest.useRealTimers();
});

it('does not measure the volume when an event is committed', async () => {
  const handle = await mountProvider();
  const after = mockFs.getFSInfo.mock.calls.length;

  await oneSession(handle.state.reportDetections);
  await oneSession(handle.state.reportDetections);

  expect(handle.state.events.length).toBe(2);
  expect(mockFs.getFSInfo).toHaveBeenCalledTimes(after);
});

it('measures once at startup and then on its own cadence', async () => {
  await mountProvider();
  const atStartup = mockFs.getFSInfo.mock.calls.length;
  expect(atStartup).toBeGreaterThan(0);

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(DISK_SWEEP_MS); });
  expect(mockFs.getFSInfo).toHaveBeenCalledTimes(atStartup + 1);

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(DISK_SWEEP_MS); });
  expect(mockFs.getFSInfo).toHaveBeenCalledTimes(atStartup + 2);
});

it('reclaims the oldest clips when the volume runs low, then re-measures', async () => {
  const now = Date.now();
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({ ...defaultSettings, autoDel: true }));
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
    { id: 3, kind: 'Personne', timestamp: now - 3_000, dur: 5, conf: 90, path: '/c/new.mp4', bytes: 300 * 1024 * 1024 },
    { id: 2, kind: 'Personne', timestamp: now - 2 * 86_400_000, dur: 5, conf: 90, path: '/c/mid.mp4', bytes: 300 * 1024 * 1024 },
    { id: 1, kind: 'Animal', timestamp: now - 3 * 86_400_000, dur: 5, conf: 90, path: '/c/old.mp4', bytes: 300 * 1024 * 1024 },
  ]));
  // Under the low-space mark, so a sweep has to reclaim.
  reportSpace(LOW_SPACE_BYTES - 100 * 1024 * 1024);

  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => {});

  // Oldest first, and only as many as the shortfall needs.
  expect(mockFs.unlink).toHaveBeenCalledWith('/c/old.mp4');
  expect(mockFs.unlink).not.toHaveBeenCalledWith('/c/new.mp4');
  expect(handle.state.events.map(e => e.id)).not.toContain(1);

  // Deciding the next sweep against a figure the deletions made stale would
  // keep reclaiming; the sweep re-measures instead.
  expect(mockFs.getFSInfo.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('leaves clips alone when auto-delete is off', async () => {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({ ...defaultSettings, autoDel: false }));
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
    { id: 1, kind: 'Animal', timestamp: Date.now(), dur: 5, conf: 90, path: '/c/old.mp4', bytes: 400 * 1024 * 1024 },
  ]));
  reportSpace(1024);

  await mountProvider();
  await ReactTestRenderer.act(async () => {});

  expect(mockFs.unlink).not.toHaveBeenCalled();
});

/**
 * Deleting a clip is the one moment a user is looking straight at the free
 * space figure, and it was the one moment it lied: the sweep that re-measures
 * was fired next to the unlink rather than after it, so `getFSInfo` answered
 * with the file still on disk and "Espace" kept counting it until the periodic
 * sweep corrected it up to 30 s later.
 */
describe('free space after a deletion', () => {
  /** An unlink that only completes when the test says so, freeing 1 GB. */
  function heldUnlink() {
    let release!: () => void;
    mockFs.unlink.mockImplementation(() => new Promise<void>(resolve => {
      release = () => { reportSpace(21 * GB); resolve(); };
    }) as never);
    return () => release();
  }

  async function seedOneClip(timestamp: number) {
    await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
      { id: 1, kind: 'Personne', timestamp, dur: 5, conf: 90, path: '/c/one.mp4', bytes: GB },
    ]));
    reportSpace(20 * GB);
  }

  it('waits for the file to be gone before believing the volume', async () => {
    await seedOneClip(Date.now());
    const release = heldUnlink();

    const handle = await mountProvider();
    expect(handle.state.storage.free).toBe(20 * GB);

    await ReactTestRenderer.act(async () => { handle.state.selectEvent(1); });
    await ReactTestRenderer.act(async () => { handle.state.doDelete(); });
    // Still holding the unlink: measuring here is measuring the old volume.
    expect(handle.state.storage.free).toBe(20 * GB);

    await ReactTestRenderer.act(async () => { release(); });
    expect(handle.state.storage.free).toBe(21 * GB);
  });

  it('re-measures after retention drops an expired clip', async () => {
    // Same stale figure by the other route: nothing in the retention prune
    // asked the volume again once its files were gone.
    await AsyncStorage.setItem(
      '@novaguard:settings',
      JSON.stringify({ ...defaultSettings, retention: '1 jour' }),
    );
    await seedOneClip(Date.now() - 3 * 86_400_000);
    // Held past the startup sweep, so the only measurement that can see the
    // freed gigabyte is the one the prune itself owes.
    const release = heldUnlink();

    const handle = await mountProvider();
    expect(mockFs.unlink).toHaveBeenCalledWith('/c/one.mp4');
    expect(handle.state.storage.free).toBe(20 * GB);

    await ReactTestRenderer.act(async () => { release(); });
    expect(handle.state.events).toHaveLength(0);
    expect(handle.state.storage.free).toBe(21 * GB);
  });
});

/**
 * An event owns two files now, and every place that deletes one has to delete
 * both. A still left behind is invisible: nothing in the app lists it, its
 * bytes are not in the storage figure, and only the next launch's orphan sweep
 * would ever reclaim it.
 */
describe('deleting an event takes its still with it', () => {
  const withStill = (id: number, timestamp: number) => ({
    id, kind: 'Personne', timestamp, dur: 5, conf: 90,
    path: `/c/${id}.mp4`, bytes: GB, thumbPath: `/c/${id}.jpg`,
  });

  it('from the detail sheet', async () => {
    await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([withStill(1, Date.now())]));
    reportSpace(20 * GB);

    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.selectEvent(1); });
    await ReactTestRenderer.act(async () => { handle.state.doDelete(); });

    expect(mockFs.unlink).toHaveBeenCalledWith('/c/1.mp4');
    expect(mockFs.unlink).toHaveBeenCalledWith('/c/1.jpg');
  });

  it('from "delete every video"', async () => {
    await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
      withStill(2, Date.now()), withStill(1, Date.now() - 1000),
    ]));
    reportSpace(20 * GB);

    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.doWipe(); });

    expect(mockFs.unlink.mock.calls.map(c => c[0]).sort())
      .toEqual(['/c/1.jpg', '/c/1.mp4', '/c/2.jpg', '/c/2.mp4']);
  });

  it('when the retention expires it', async () => {
    await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({ ...defaultSettings, retention: '7 jours' }));
    await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
      withStill(1, Date.now() - 30 * 86_400_000),
    ]));
    reportSpace(20 * GB);

    await mountProvider();
    await ReactTestRenderer.act(async () => {});

    expect(mockFs.unlink).toHaveBeenCalledWith('/c/1.jpg');
  });

  it('when the volume runs low and the sweep reclaims it', async () => {
    await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({ ...defaultSettings, autoDel: true }));
    await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
      withStill(2, Date.now()), withStill(1, Date.now() - 2 * 86_400_000),
    ]));
    reportSpace(LOW_SPACE_BYTES - 100 * 1024 * 1024);

    await mountProvider();
    await ReactTestRenderer.act(async () => {});

    expect(mockFs.unlink).toHaveBeenCalledWith('/c/1.jpg');
  });
});
