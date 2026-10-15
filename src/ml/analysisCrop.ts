import { DetectionBox } from './types';
import { Rotation } from '../camera/orientation';

/**
 * The part of the frame the detector is shown when a zone is set.
 *
 * The whole frame used to be scaled into the model's 320 px square whatever
 * the zone, so a zone covering a third of the field — a gate, a strip of
 * garden — gave a subject there a third of the pixels it could have had. Those
 * are the subjects the zone exists for, and the far ones among them are exactly
 * where EfficientDet-Lite0 runs out of resolution. Showing it only the zone
 * multiplies the resolution on target by the inverse of the crop's size, for
 * no extra computation; "Détection étendue" costs three times as much for less.
 *
 * Nothing that counts is lost. The zone test is on the foot point
 * (`inZone`), so a subject is in scope only if their feet are inside the zone;
 * the crop keeps the zone itself, a margin on each side for a body straddling
 * its edge, and room above for the body standing on it. A crop that would keep
 * most of the frame anyway is not worth the conversion and is not made.
 */

export const FULL_FRAME: DetectionBox = { x: 0, y: 0, width: 1, height: 1 };

/** Side margin, as a fraction of the frame. */
const SIDE_MARGIN = 0.1;
/** Below the zone: the foot point sits on its bottom edge at worst. */
const BOTTOM_MARGIN = 0.05;
/**
 * Room kept above the zone for the body whose feet are in it: at least this
 * much of the frame, or 1.5 times the zone's own height when that is more —
 * a deep zone is a near one, and near subjects are tall.
 */
const MIN_HEADROOM = 0.4;
const HEADROOM_PER_ZONE_HEIGHT = 1.5;
/** Above this share of the frame, the crop gains too little to be worth it. */
const MAX_CROP_AREA = 0.6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The region to analyse, in the uprighted frame's normalized space. Computed on
 * the JS side once per zone change and handed to the worklet as four numbers.
 */
export function analysisCropFor(zone: DetectionBox | null): DetectionBox {
  if (zone == null) return FULL_FRAME;
  const x0 = clamp01(zone.x - SIDE_MARGIN);
  const x1 = clamp01(zone.x + zone.width + SIDE_MARGIN);
  const y0 = clamp01(zone.y - Math.max(MIN_HEADROOM, zone.height * HEADROOM_PER_ZONE_HEIGHT));
  const y1 = clamp01(zone.y + zone.height + BOTTOM_MARGIN);
  const crop = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (crop.width <= 0 || crop.height <= 0 || crop.width * crop.height > MAX_CROP_AREA) return FULL_FRAME;
  return crop;
}

/**
 * An uprighted-space rectangle expressed in the frame buffer's own axes, which
 * is what the resize plugin crops in: it crops and scales *before* it rotates.
 * `rotation` is the clockwise turn that uprights the buffer (`uprightRotation`).
 *
 * Takes the rectangle as numbers, not an object, because that is how the
 * worklet receives it (see `CameraFeed`).
 */
export function cropInBuffer(x: number, y: number, width: number, height: number, rotation: Rotation): DetectionBox {
  'worklet';
  switch (rotation) {
    // Buffer turned 90° clockwise to upright: upright (u, v) came from buffer (v, 1 - u).
    case '90deg': return { x: y, y: 1 - x - width, width: height, height: width };
    case '180deg': return { x: 1 - x - width, y: 1 - y - height, width, height };
    // Turned 270°: upright (u, v) came from buffer (1 - v, u).
    case '270deg': return { x: 1 - y - height, y: x, width: height, height: width };
    default: return { x, y, width, height };
  }
}
