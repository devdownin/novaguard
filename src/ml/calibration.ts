import { DetectionBox, FrameDetection } from './types';
import { DetectionKind } from '../state/types';
import { iou, Track } from './tracker';

/** Why a box is seen by the detector but not treated as a subject. */
export type ProbeState = 'pending' | 'scenery' | 'below';

export interface Probe {
  key: string;
  box: DetectionBox;
  kind: DetectionKind;
  confidence: number;
  state: ProbeState;
}

/** A detection overlapping a track this much is that track's look, not a stray box. */
const SAME_SUBJECT_IOU = 0.3;

export const NO_PROBES: Probe[] = [];

/**
 * What calibration mode adds to the overlay: everything the detector saw this
 * look that the app does *not* treat as a subject, with the reason.
 *
 * - `pending`: a track still collecting the looks `confirmAfter` asks for;
 * - `scenery`: a confirmed track held as part of the room (`scenery.ts`);
 * - `below`: a detection that opened nothing — under its kind's entry
 *   threshold, or smaller than `minStartSide`.
 *
 * Seen tracks only (`misses === 0`): a box drawn where the subject was a
 * second ago is a prediction, and the overlay never draws predictions.
 */
export function calibrationProbes(
  detections: readonly FrameDetection[], tracks: readonly Track[], subjects: readonly Track[],
): Probe[] {
  const subjectIds = new Set(subjects.map(track => track.id));
  const probes: Probe[] = [];
  for (const track of tracks) {
    if (track.misses !== 0 || (track.confirmed && subjectIds.has(track.id))) continue;
    probes.push({
      key: `t${track.id}`, box: track.box, kind: track.kind, confidence: track.confidence,
      state: track.confirmed ? 'scenery' : 'pending',
    });
  }
  detections.forEach((detection, index) => {
    if (tracks.some(track => track.misses === 0 && iou(track.box, detection.box) >= SAME_SUBJECT_IOU)) return;
    probes.push({ key: `d${index}`, box: detection.box, kind: detection.kind, confidence: detection.confidence, state: 'below' });
  });
  return probes.length === 0 ? NO_PROBES : probes;
}
