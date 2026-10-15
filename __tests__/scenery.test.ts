import { DEFAULT_TRACKER_OPTIONS, Track, updateTracks } from '../src/ml/tracker';
import { isScenery, rememberScenery, SCENERY_AFTER_MS, SCENERY_FORGET_MS, SceneryMark, withoutScenery } from '../src/ml/scenery';
import { FrameDetection } from '../src/ml/types';

const coat = (dx = 0): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.8, box: { x: 0.4 + dx, y: 0.2, width: 0.15, height: 0.5 } });

/** Feeds the same detections every `step` ms for `duration` ms, starting at `from`. */
function hold(tracks: Track[], detection: () => FrameDetection, from: number, duration: number, step = 1000) {
  let current = tracks;
  for (let at = from; at <= from + duration; at += step) current = updateTracks(current, [detection()], at, DEFAULT_TRACKER_OPTIONS);
  return current;
}

describe('scenery', () => {
  it('is a subject until it has stood still for the whole delay, then scenery', () => {
    const almost = hold([], () => coat(), 0, SCENERY_AFTER_MS - 1000);
    expect(isScenery(almost[0], [], SCENERY_AFTER_MS - 1000)).toBe(false);
    const still = hold(almost, () => coat(), SCENERY_AFTER_MS, 0);
    expect(isScenery(still[0], [], SCENERY_AFTER_MS)).toBe(true);
  });

  it('tolerates box jitter but not a real move, which makes it a subject again', () => {
    let tracks = hold([], () => coat(Math.random() * 0.004), 0, SCENERY_AFTER_MS);
    expect(isScenery(tracks[0], [], SCENERY_AFTER_MS)).toBe(true);
    tracks = updateTracks(tracks, [coat(0.06)], SCENERY_AFTER_MS + 1000, DEFAULT_TRACKER_OPTIONS);
    expect(tracks).toHaveLength(1);
    expect(isScenery(tracks[0], [], SCENERY_AFTER_MS + 1000)).toBe(false);
  });

  it('recognises scenery again at once when its track restarts on the same spot', () => {
    const tracks = hold([], () => coat(), 0, SCENERY_AFTER_MS);
    const marks = rememberScenery([], tracks, SCENERY_AFTER_MS);
    expect(marks).toHaveLength(1);
    // The detector lost it long enough for the track to be dropped.
    const restarted = updateTracks([], [coat()], SCENERY_AFTER_MS + 60_000, DEFAULT_TRACKER_OPTIONS);
    expect(isScenery(restarted[0], marks, SCENERY_AFTER_MS + 60_000)).toBe(true);
    // Somebody new standing elsewhere is not.
    const visitor = updateTracks([], [coat(0.3)], SCENERY_AFTER_MS + 60_000, DEFAULT_TRACKER_OPTIONS);
    expect(isScenery(visitor[0], marks, SCENERY_AFTER_MS + 60_000)).toBe(false);
  });

  it('forgets a place once nothing has been seen there for a while', () => {
    const marks: SceneryMark[] = [{ box: coat().box, lastSeen: 0 }];
    expect(rememberScenery(marks, [], SCENERY_FORGET_MS - 1)).toBe(marks);
    expect(rememberScenery(marks, [], SCENERY_FORGET_MS)).toEqual([]);
  });

  it('hands back the same array when nothing is scenery', () => {
    const tracks = hold([], () => coat(), 0, 5000);
    expect(withoutScenery(tracks, [], 5000)).toBe(tracks);
    const marks: SceneryMark[] = [];
    expect(rememberScenery(marks, tracks, 5000)).toBe(marks);
  });
});
