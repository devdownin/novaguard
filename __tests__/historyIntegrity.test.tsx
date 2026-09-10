/**
 * What startup is allowed to delete.
 *
 * The launch sweep removes every clip on disk that no event points at, which is
 * the only way orphans left by a crash ever go away. It reads that list of
 * events from AsyncStorage — and the loader used to answer `null` both when the
 * key had never been written and when it could not be read or parsed. On the
 * second answer the sweep saw an empty history over a full directory and
 * deleted every recording the user had, silently, before the app had drawn a
 * frame. The write-back then replaced the stored history with `[]`, so the next
 * launch agreed.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from '@dr.pogodin/react-native-fs';
import { mountProvider } from '../testing/mountProvider';

const mockFs = fs as jest.Mocked<typeof fs>;

const EVENTS_KEY = '@novaguard:events:v2';
const CLIPS = ['/tmp/novaguard-test/recordings/a.mp4', '/tmp/novaguard-test/recordings/b.mp4'];

/** Two clips sitting in the recordings directory, claimed by nothing. */
function clipsOnDisk() {
  mockFs.exists.mockResolvedValue(true);
  mockFs.readDir.mockResolvedValue(
    CLIPS.map(path => ({ path, isFile: () => true, isDirectory: () => false })) as never,
  );
}

/** The sweep runs after hydration has already been reported; let it finish. */
async function settle() {
  await ReactTestRenderer.act(async () => {});
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: 0, totalSpace: 0, freeSpaceEx: 0, totalSpaceEx: 0,
  } as never);
  clipsOnDisk();
});

afterEach(async () => {
  // The provider's clock and disk sweep are still armed; drain them inside act
  // so their state updates do not land after the test has finished.
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

describe('an unreadable history', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem(EVENTS_KEY, '{ this is not the json we wrote');
  });

  it('deletes nothing', async () => {
    await mountProvider();
    await settle();

    expect(mockFs.unlink).not.toHaveBeenCalled();
  });

  it('does not overwrite what it could not read', async () => {
    const box = await mountProvider();
    await settle();
    // Any state change flushes the persist effect; a detection is the one that
    // happens on its own, so this is the realistic path to the write.
    await ReactTestRenderer.act(async () => { box.state.selectEvent(null); });
    await settle();

    await expect(AsyncStorage.getItem(EVENTS_KEY)).resolves.toBe('{ this is not the json we wrote');
  });

  it('says so instead of showing an empty Historique', async () => {
    const box = await mountProvider();
    await settle();

    expect(box.state.recError).toBe('Historique illisible : les vidéos sont conservées');
  });
});

describe('a history that read fine', () => {
  it('still sweeps the clips no event claims', async () => {
    // The control: without it, "deletes nothing" would also pass on a sweep
    // that had simply been switched off.
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([]));

    await mountProvider();
    await settle();

    expect(mockFs.unlink.mock.calls.map(([path]) => path).sort()).toEqual(CLIPS);
  });

  it('keeps the clips its events point at', async () => {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([
      { id: 1, kind: 'Personne', timestamp: Date.now(), dur: 8, conf: 91, path: CLIPS[0], bytes: 1024 },
    ]));

    await mountProvider();
    await settle();

    expect(mockFs.unlink.mock.calls.map(([path]) => path)).toEqual([CLIPS[1]]);
  });

  it('sweeps on a genuine first launch, where nothing has ever been written', async () => {
    // `null` from an absent key must keep meaning "no events", or a crash
    // before the first save would leave its clip on disk forever.
    await mountProvider();
    await settle();

    expect(mockFs.unlink.mock.calls.map(([path]) => path).sort()).toEqual(CLIPS);
  });
});

/**
 * Stills live in the recordings directory next to the clips they belong to, so
 * they fall under the same sweep. The sweep asks each event which files it
 * claims — and while an event claimed only its clip, the first launch after a
 * detection deleted every thumbnail the app had just taken.
 */
describe('the stills the sweep has to know about', () => {
  const CLIP = '/tmp/novaguard-test/recordings/kept.mp4';
  const STILL = '/tmp/novaguard-test/recordings/kept.jpg';
  const STRAY = '/tmp/novaguard-test/recordings/stray.jpg';

  beforeEach(() => {
    mockFs.exists.mockResolvedValue(true);
    mockFs.readDir.mockResolvedValue(
      [CLIP, STILL, STRAY].map(path => ({ path, isFile: () => true, isDirectory: () => false })) as never,
    );
  });

  it('keeps the still an event points at, and only sweeps the one nothing claims', async () => {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([
      { id: 1, kind: 'Personne', timestamp: Date.now(), dur: 5, conf: 90, path: CLIP, bytes: 1024, thumbPath: STILL },
    ]));

    await mountProvider();
    await settle();

    expect(mockFs.unlink).toHaveBeenCalledWith(STRAY);
    expect(mockFs.unlink).not.toHaveBeenCalledWith(STILL);
    expect(mockFs.unlink).not.toHaveBeenCalledWith(CLIP);
  });

  it('sweeps a still whose event was written before thumbnails existed', async () => {
    // No `thumbPath` at all on disk — the field is newer than the history.
    // The event still claims its clip, and nothing claims the JPEGs.
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([
      { id: 1, kind: 'Personne', timestamp: Date.now(), dur: 5, conf: 90, path: CLIP, bytes: 1024 },
    ]));

    await mountProvider();
    await settle();

    expect(mockFs.unlink).toHaveBeenCalledWith(STILL);
    expect(mockFs.unlink).not.toHaveBeenCalledWith(CLIP);
  });
});
