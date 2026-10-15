import type { DetectionBox } from '../ml/types';
import type { SubjectSample } from '../state/types';

/**
 * Where the subject was during a clip, for an agent that asks to see it closer.
 *
 * Stored with every event and written to AsyncStorage with the journal, so it
 * is small by construction: a sample a second at most while recording, folded
 * down to {@link MAX_SAMPLES} spread evenly over the clip, three decimals each.
 * A box at one instant is enough for a frame extractor to crop around the
 * subject at that instant; a box per analysed frame would be the journal
 * growing five entries a second for nobody.
 */
export const MAX_SAMPLES = 30;
export const MIN_GAP_MS = 1000;

export interface RawSample { at: number; box: DetectionBox }

/** Mutates and returns `trail`: called on the frame path, where a copy a look is waste. */
export function recordSubject(trail: RawSample[], at: number, box: DetectionBox): RawSample[] {
  const last = trail[trail.length - 1];
  if (last && at - last.at < MIN_GAP_MS) return trail;
  trail.push({ at, box });
  // Halved in place once it holds four times what is kept: bounded memory for
  // a passage of any length, and still dense enough to pick evenly from.
  if (trail.length > MAX_SAMPLES * 4) {
    let write = 0;
    for (let read = 0; read < trail.length; read += 2) trail[write++] = trail[read];
    trail.length = write;
  }
  return trail;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The samples of the clip that began at `startAt`, relative to it, evenly thinned. */
export function trailSince(trail: RawSample[], startAt: number): SubjectSample[] {
  const inClip = trail.filter(sample => sample.at >= startAt);
  const step = Math.max(1, inClip.length / MAX_SAMPLES);
  const picked: RawSample[] = [];
  for (let i = 0; i < inClip.length && picked.length < MAX_SAMPLES; i += step) picked.push(inClip[Math.floor(i)]);
  return picked.map(({ at, box }) => ({
    t: at - startAt, x: round(box.x), y: round(box.y), w: round(box.width), h: round(box.height),
  }));
}
