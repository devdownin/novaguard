/**
 * The tamper watch: a covered lens or a turned phone must not pass for an
 * empty room.
 *
 * @format
 */
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import {
  acknowledgeMove, IDLE_WATCH, MOVED_AFTER_MS, OBSTRUCTED_AFTER_MS, sceneSimilarity, TamperWatch, watchScene,
} from '../src/surveillance/tamper';
import { sceneSample, SCENE_GRID } from '../src/ml/lowLight';
import { mountLegacyProvider } from '../testing/mountProvider';

jest.mock('../src/surveillance/foregroundService');

const CELLS = SCENE_GRID * SCENE_GRID;
/** A left-bright, right-dark room, at `level` overall. */
const room = (level = 1): number[] => {
  const grid = Array.from({ length: CELLS }, (_, i) => ((i % SCENE_GRID) < SCENE_GRID / 2 ? 160 : 60) * level);
  return [grid.reduce((a, b) => a + b, 0) / CELLS, ...grid];
};
/** The same room seen after a quarter turn: bright on top instead. */
const turned = (): number[] => {
  const grid = Array.from({ length: CELLS }, (_, i) => (Math.floor(i / SCENE_GRID) < SCENE_GRID / 2 ? 160 : 60));
  return [110, ...grid];
};
const black = (): number[] => [2, ...new Array(CELLS).fill(2)];

const run = (frames: number[][], subjects = false, from: TamperWatch = IDLE_WATCH, step = 500) =>
  frames.reduce((watch, sample, i) => watchScene(watch, sample, subjects, i * step), from);

describe('sceneSimilarity', () => {
  it('ignores the overall level and sees a change of layout', () => {
    expect(sceneSimilarity(room().slice(1), room(0.5).slice(1))).toBeCloseTo(1, 5);
    expect(sceneSimilarity(room().slice(1), turned().slice(1))).toBeLessThan(0.5);
  });
});

describe('watchScene', () => {
  it('calls a black picture after it lasts, and lets it go when light returns', () => {
    const frames = (ms: number) => Array.from({ length: ms / 500 + 1 }, black);
    expect(run(frames(OBSTRUCTED_AFTER_MS - 500)).obstructed).toBe(false);
    const dark = run(frames(OBSTRUCTED_AFTER_MS));
    expect(dark.obstructed).toBe(true);
    expect(watchScene(dark, room(), false, 99_000).obstructed).toBe(false);
  });

  it('latches a changed view with nobody in it, once, until acknowledged', () => {
    const steps = MOVED_AFTER_MS / 500 + 1;
    const moved = run([room(), ...Array.from({ length: steps }, turned)]);
    expect(moved.movedAt).not.toBeNull();
    // Still turned: no second alert, the new view is now the reference.
    const later = watchScene(moved, turned(), false, 60_000);
    expect(later.movedAt).toBe(moved.movedAt);
    expect(acknowledgeMove(later).movedAt).toBeNull();
  });

  it('does not take a visitor or dusk for a move', () => {
    const steps = MOVED_AFTER_MS / 500 + 2;
    // The reference is taken on an empty room; then someone fills the view.
    const seen = watchScene(IDLE_WATCH, room(), false, 0);
    expect(run(Array.from({ length: steps }, turned), true, seen).movedAt).toBeNull();
    expect(run([room(), ...Array.from({ length: steps }, () => room(0.4))]).movedAt).toBeNull();
  });

  it('wants the change to last', () => {
    const brief = Array.from({ length: MOVED_AFTER_MS / 500 - 2 }, turned);
    expect(run([room(), ...brief, room()]).movedAt).toBeNull();
  });
});

describe('sceneSample', () => {
  it('reads the mean and the layout of the image part', () => {
    const size = 16; const w = 16; const h = 16;
    const input = new Uint8Array(size * size * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? 200 : 0;
      input.set([v, v, v], (y * size + x) * 3);
    }
    const sample = sceneSample(input, w, h, size, 3);
    expect(sample).toHaveLength(1 + CELLS);
    expect(sample[0]).toBeCloseTo(100, 0);
    expect(sample[1]).toBeCloseTo(200, 0);
    expect(sample[SCENE_GRID]).toBeCloseTo(0, 0);
  });
});

describe('in the app', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
    await AsyncStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  const feed = async (handle: { state: { reportDetections: (...a: any[]) => void } }, sample: () => number[], ms: number) => {
    for (let t = 0; t <= ms; t += 500) {
      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(500);
        handle.state.reportDetections([], 9 / 16, undefined, sample());
      });
    }
  };

  it('turns a black picture and a turned camera into statuses, with their own way out', async () => {
    const handle = await mountLegacyProvider();
    await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });

    await feed(handle, black, OBSTRUCTED_AFTER_MS + 500);
    expect(handle.state.surveillanceStatus).toBe('camera-obstructed');

    await feed(handle, room, 1000);
    expect(handle.state.surveillanceStatus).not.toBe('camera-obstructed');

    await feed(handle, turned, MOVED_AFTER_MS + 500);
    expect(handle.state.surveillanceStatus).toBe('camera-moved');

    await ReactTestRenderer.act(async () => { handle.state.acknowledgeMove(); });
    expect(handle.state.surveillanceStatus).not.toBe('camera-moved');
  });
});
