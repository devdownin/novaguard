import { DetectionBox, FrameDetection } from './types';

/**
 * The watched zone: the part of the frame a detection has to be in to count.
 *
 * A phone on a windowsill sees the street, the pavement and the neighbour's
 * door as well as the garden it was put there for, and every passer-by was a
 * recording. No threshold fixes that — those detections are correct — so the
 * only answer is to say where the camera is actually watching. It is also the
 * cheapest filter in the app: a comparison per detection, against an inference
 * that costs milliseconds.
 */

/**
 * Smallest side a zone may have, as a fraction of the frame.
 *
 * A stray tap on the viewfinder would otherwise leave a zone a few pixels
 * across, which is indistinguishable from a camera that has stopped working —
 * and the app would say nothing, because a zone that matches nothing is exactly
 * what an empty scene looks like.
 */
export const MIN_ZONE_SIDE = 0.08;

/** True when a drawn rectangle is worth keeping as a zone at all. */
export function isUsableZone(zone: DetectionBox): boolean {
  return zone.width >= MIN_ZONE_SIDE && zone.height >= MIN_ZONE_SIDE;
}

/**
 * Whether a subject stands inside the zone.
 *
 * Tested on the foot point — bottom centre of the box — rather than the whole
 * box or its middle. A zone is drawn on the ground the camera watches, and a
 * person standing just outside it still has their head and shoulders over it:
 * requiring containment of the whole box would miss anyone at the near edge,
 * and testing the centre puts the boundary at chest height, where it moves with
 * how much of somebody the detector happened to include.
 */
export function inZone(box: DetectionBox, zone: DetectionBox): boolean {
  const x = box.x + box.width / 2;
  const y = box.y + box.height;
  return x >= zone.x && x <= zone.x + zone.width
    && y >= zone.y && y <= zone.y + zone.height;
}

/**
 * The detections the zone lets through, reusing the input array when it lets
 * all of them through — which, with no zone set or a subject in shot, is every
 * frame the app ever analyses.
 */
export function detectionsInZone(
  detections: FrameDetection[],
  zone: DetectionBox | null,
): FrameDetection[] {
  if (zone == null) return detections;
  let kept = 0;
  for (const detection of detections) if (inZone(detection.box, zone)) kept++;
  if (kept === detections.length) return detections;
  return detections.filter(detection => inZone(detection.box, zone));
}
