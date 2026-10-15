import { DetectionBox } from './types';
import { iou, STILL_IOU, Track } from './tracker';

/**
 * Detections that are part of the room, not visitors to it.
 *
 * A coat on a hook, a poster, a statue in the garden: the detector reads them
 * as a person every look, with a steady score, and the tracker confirms them
 * like anyone else — so a camera pointed at one recorded all night. Nothing in
 * the score separates them from a real subject; what does is that they never
 * move. A confirmed track whose box has stayed on its anchor for
 * `SCENERY_AFTER_MS` is treated as scenery: it no longer opens a recording nor
 * keeps one open. It is not deleted — the moment it leaves its anchor the
 * tracker resets `anchorSince` and it is a subject again.
 *
 * The price is someone genuinely motionless for that long, which is why the
 * delay is minutes, not seconds, and why moving even once brings them back.
 */
export const SCENERY_AFTER_MS = 3 * 60_000;

/**
 * How long a place stays known as scenery once nothing is seen there.
 *
 * The detector drops a static object for a look or two often enough that its
 * track is let go and a new one starts on the same spot, with a fresh anchor.
 * Without a memory of where scenery stood, every such restart was another
 * three minutes of recording a coat.
 */
export const SCENERY_FORGET_MS = 10 * 60_000;

export interface SceneryMark {
  box: DetectionBox;
  lastSeen: number;
}

/** True when `track` should be ignored as part of the scene at `now`. */
export function isScenery(track: Track, marks: readonly SceneryMark[], now: number): boolean {
  if (now - track.anchorSince >= SCENERY_AFTER_MS) return true;
  // A track that has not moved since it appeared, on a spot already known as
  // scenery, is that scenery seen again — not a newcomer.
  if (track.anchorSince !== track.firstSeen) return false;
  for (const mark of marks) if (iou(track.anchor, mark.box) >= STILL_IOU) return true;
  return false;
}

/**
 * The scenery marks after this look: refreshed where a scenery track still
 * stands, added where one has just become scenery, forgotten after
 * `SCENERY_FORGET_MS` unseen. Returns `marks` itself while no scenery is in
 * sight and none expires, which is every frame of a scene without any.
 */
export function rememberScenery(marks: SceneryMark[], tracks: readonly Track[], now: number): SceneryMark[] {
  let next: SceneryMark[] | null = null;
  for (const track of tracks) {
    if (track.misses !== 0 || !isScenery(track, marks, now)) continue;
    next ??= marks.slice();
    const known = next.findIndex(mark => iou(track.anchor, mark.box) >= STILL_IOU);
    if (known >= 0) next[known] = { box: next[known].box, lastSeen: now };
    else next.push({ box: track.anchor, lastSeen: now });
  }
  const source = next ?? marks;
  if (!source.some(mark => now - mark.lastSeen >= SCENERY_FORGET_MS)) return source;
  return source.filter(mark => now - mark.lastSeen < SCENERY_FORGET_MS);
}

/** `tracks` without the scenery, or `tracks` itself when none of it is scenery. */
export function withoutScenery(tracks: Track[], marks: readonly SceneryMark[], now: number): Track[] {
  let scenery = 0;
  for (const track of tracks) if (isScenery(track, marks, now)) scenery++;
  return scenery === 0 ? tracks : tracks.filter(track => !isScenery(track, marks, now));
}
