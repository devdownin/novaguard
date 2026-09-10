import { DetectionBox } from '../ml/types';
import { iou } from '../ml/tracker';

/**
 * Geometry for the cinematic auto-zoom.
 *
 * Everything here is pure and unit-tested (`__tests__/framing.test.ts`) — it is
 * the one part of the auto-zoom that can be verified without a device.
 *
 * Coordinate spaces:
 * - "upright-frame space": normalized 0–1 inside the whole camera frame, after
 *   it has been rotated upright — what `interpretDetections` returns. The
 *   resize plugin is handed the entire frame and stretches it into the model's
 *   square input, so a box comes back normalized against the frame, not against
 *   a crop of it. It described a centred square crop until that crop was
 *   removed for throwing away the sides of the field of view; a reader who
 *   believed the old wording would go looking for a square-to-frame conversion
 *   that must not exist.
 * - "view space": normalized 0–1 inside the viewfinder rect, which is what the
 *   overlay draws in and what the zoom transform operates on. Face boxes arrive
 *   here directly: ML Kit is given the viewfinder's own size as its window, so
 *   `CameraFeed` only divides its pixels by that size.
 */

export interface Framing {
  scale: number;
  translateX: number;
  translateY: number;
}

export const NEUTRAL_FRAMING: Framing = { scale: 1, translateX: 0, translateY: 0 };

/** Union of several boxes; null if the list is empty. */
export function unionBox(boxes: DetectionBox[]): DetectionBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Area of a box, in whatever space it is expressed. */
function areaOf(box: DetectionBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/** How much of `inner` falls inside `outer`, as a fraction of `inner` (0–1). */
export function containedFraction(inner: DetectionBox, outer: DetectionBox): number {
  const area = areaOf(inner);
  if (area <= 0) return 0;
  const x = Math.max(inner.x, outer.x);
  const y = Math.max(inner.y, outer.y);
  const right = Math.min(inner.x + inner.width, outer.x + outer.width);
  const bottom = Math.min(inner.y + inner.height, outer.y + outer.height);
  if (right <= x || bottom <= y) return 0;
  return ((right - x) * (bottom - y)) / area;
}

/** Most of a face has to sit inside a body box before we call it that body's face. */
const FACE_BELONGS = 0.5;

/**
 * The one person the close-up should be built around, framed head to toe.
 *
 * The move used to be built on the face box, which is what "zoom auto sur les
 * visages" meant literally and what made it useless as evidence: a head filling
 * the screen while the hands, what they carry and where they are going all sit
 * outside the recorded crop. The subject of the move is a *person*, so the box
 * returned here is a person box — never a face.
 *
 * Faces still earn their keep, in two ways that do not put one on screen alone:
 * they pick which person the camera looks at when several are in shot (the one
 * facing the camera is the one whose face was found), and they are unioned into
 * the chosen person, so a detection that clipped the head still frames a whole
 * person. Without any face the largest person — the nearest one — is the
 * subject, because a subject seen from behind must still be zoomed on.
 */
export function subjectBox(persons: DetectionBox[], faces: DetectionBox[]): DetectionBox | null {
  if (persons.length === 0) return null;

  let best: DetectionBox | null = null;
  let bestArea = -1;
  let bestHasFace = false;

  for (const person of persons) {
    const own = faces.filter(face => containedFraction(face, person) >= FACE_BELONGS);
    const hasFace = own.length > 0;
    const area = areaOf(person);
    // A face outranks size; between two faces, the nearer subject wins.
    if (best && bestHasFace && !hasFace) continue;
    if (best && hasFace === bestHasFace && area <= bestArea) continue;
    best = hasFace ? unionBox([person, ...own])! : person;
    bestArea = area;
    bestHasFace = hasFace;
  }

  return best;
}

/**
 * Converts a box normalized to the (uprighted) camera frame into a box
 * normalized to the viewfinder rect.
 *
 * The preview renders with `resizeMode="cover"`, so the frame is scaled until
 * it covers the view and the excess on the long axis is cropped evenly at both
 * ends — this reproduces exactly that, which is why the overlay and the zoom
 * always agree with what is actually on screen.
 */
export function uprightBoxToViewBox(
  box: DetectionBox,
  frameAspect: number,
  viewW: number,
  viewH: number,
): DetectionBox {
  if (viewW <= 0 || viewH <= 0 || frameAspect <= 0) return box;
  const ratio = frameAspect / (viewW / viewH);

  if (ratio > 1) {
    // Frame is wider than the view: full height shown, sides cropped.
    return {
      x: (box.x - 0.5) * ratio + 0.5,
      y: box.y,
      width: box.width * ratio,
      height: box.height,
    };
  }
  // Frame is taller than the view: full width shown, top and bottom cropped.
  return {
    x: box.x,
    y: (box.y - 0.5) / ratio + 0.5,
    width: box.width,
    height: box.height / ratio,
  };
}

/**
 * The inverse of {@link uprightBoxToViewBox}: a box the user drew on the
 * viewfinder, expressed against the frame the detector sees.
 *
 * The detection zone is stored in upright-frame space and nowhere else. Storing
 * what was drawn — view space — would tie it to the viewfinder's size and to
 * whatever the preview transform happened to be doing at the time, so the same
 * zone would mean a different part of the room after a rotation. Both are
 * avoided by converting once, on the way in.
 */
export function viewBoxToUprightBox(
  box: DetectionBox,
  frameAspect: number,
  viewW: number,
  viewH: number,
): DetectionBox {
  if (viewW <= 0 || viewH <= 0 || frameAspect <= 0) return box;
  const ratio = frameAspect / (viewW / viewH);

  if (ratio > 1) {
    return {
      x: (box.x - 0.5) / ratio + 0.5,
      y: box.y,
      width: box.width / ratio,
      height: box.height,
    };
  }
  return {
    x: box.x,
    y: (box.y - 0.5) * ratio + 0.5,
    width: box.width,
    height: box.height * ratio,
  };
}

/** Grows a box by `ratio` of its size on every side, clamped to 0–1. */
export function padBox(box: DetectionBox, ratio: number): DetectionBox {
  const dx = box.width * ratio;
  const dy = box.height * ratio;
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return {
    x,
    y,
    width: Math.min(1 - x, box.width + dx * 2),
    height: Math.min(1 - y, box.height + dy * 2),
  };
}

/** Exponential moving average between two boxes — damps per-frame jitter. */
export function smoothBox(previous: DetectionBox | null, next: DetectionBox, alpha: number): DetectionBox {
  if (!previous) return next;
  const mix = (a: number, b: number) => a + (b - a) * alpha;
  return {
    x: mix(previous.x, next.x),
    y: mix(previous.y, next.y),
    width: mix(previous.width, next.width),
    height: mix(previous.height, next.height),
  };
}

/**
 * Largest capture zoom that still holds `box` entirely in frame.
 *
 * `<Camera zoom>` is a centre crop of the sensor: at factor `z` only the middle
 * `1/z` of each axis survives, and there is no way to offset it. So a subject
 * that is not centred bounds how far the capture may zoom before it crops that
 * subject away — which on a surveillance camera is not a cosmetic failure but
 * the loss of the thing being recorded. A box touching an edge allows no zoom
 * at all, and the answer is never below 1.
 *
 * The preview does not need this: its transform can pan, so it frames the
 * subject wherever it is. Only the capture is stuck with the centre.
 */
export function maxZoomKeepingInFrame(box: DetectionBox): number {
  if (box.width <= 0 || box.height <= 0) return 1;
  // Distance from the frame centre to the box's furthest edge, per axis.
  const halfX = Math.max(0.5 - box.x, box.x + box.width - 0.5);
  const halfY = Math.max(0.5 - box.y, box.y + box.height - 0.5);
  const half = Math.max(halfX, halfY);
  if (half <= 0) return Infinity;
  return Math.max(1, 0.5 / half);
}

/**
 * Where `box` lands once the camera itself has zoomed by `zoom`.
 *
 * The capture zoom changes what the frame *is*, so everything downstream — the
 * viewfinder transform, the overlay — has to be computed against the cropped
 * frame rather than the sensor's full field of view. Feeding the result to
 * `computeFraming` is what keeps the two magnifications from multiplying: the
 * box is larger in the cropped frame, so the residual scale it asks for is
 * smaller by exactly the factor the camera already applied.
 */
export function boxInZoomedFrame(box: DetectionBox, zoom: number): DetectionBox {
  if (!(zoom > 0)) return box;
  return {
    x: (box.x - 0.5) * zoom + 0.5,
    y: (box.y - 0.5) * zoom + 0.5,
    width: box.width * zoom,
    height: box.height * zoom,
  };
}

/**
 * Largest capture zoom whose change of coordinates the tracker can still follow.
 *
 * A capture zoom is not a movement — the subject has not gone anywhere — but
 * the tracker cannot tell the difference: every box it holds is expressed in a
 * frame that has just been recropped, so on the next frame the same subject
 * arrives somewhere else. `updateTracks` matches on overlap, so past a certain
 * step it stops recognising the subject, drops the track and starts a new one
 * that needs `confirmAfter` frames to be trusted again — during which there is
 * no confirmed subject at all and the post-roll arms.
 *
 * A flat ceiling does not fix this. A centred box only grows, so its overlap is
 * `1/z²` and 2x is the limit — but an off-centre one is *translated* far more
 * than it grows, and at barely 1.5x can end up not overlapping its old position
 * at all. The bound has to be the subject's own, which is what this computes.
 *
 * Measured with the tracker's own `iou`, deliberately: a bound calculated with
 * a different notion of overlap than the one that will judge it is no bound.
 * Overlap falls monotonically as the crop tightens, so a bisection finds the
 * edge; it runs when a move ends, never per frame.
 */
export function maxZoomTrackable(box: DetectionBox, minOverlap: number, ceiling = 4): number {
  if (box.width <= 0 || box.height <= 0) return 1;
  const overlapAt = (zoom: number) => iou(box, boxInZoomedFrame(box, zoom));
  if (overlapAt(ceiling) >= minOverlap) return ceiling;

  let keeps = 1;
  let loses = ceiling;
  for (let i = 0; i < 40; i++) {
    const mid = (keeps + loses) / 2;
    if (overlapAt(mid) >= minOverlap) keeps = mid;
    else loses = mid;
  }
  return keeps;
}

/**
 * Overlap a subject must still have with itself across a capture zoom.
 *
 * Above the tracker's own threshold on purpose: the subject is usually moving
 * as well, and that motion spends overlap too. At the tracker's exact figure a
 * zoom that is *just* followable stops being followable the moment anybody
 * takes a step.
 */
export const TRACK_OVERLAP_FLOOR = 0.32;

/**
 * Most of the room the capture is ever allowed to give up.
 *
 * A capture zoom of `z` keeps `1/z²` of the sensor's area, and what it drops is
 * dropped from *everything* downstream: CameraX applies the crop to the whole
 * use-case group, so the discarded part of the room is neither recorded nor
 * handed to the detection model. At the 1.77x the tracker bound alone allowed,
 * two thirds of the field of view stopped existing for as long as the close
 * shot was held — and somebody walking in from the side during those seconds
 * was not filmed *and* not seen.
 *
 * 1.41 is `sqrt(2)`: half the area kept, half given up. Not a compromise picked
 * for its looks — it is the point where a surveillance camera stops being able
 * to miss more of the room than it watches. The magnification the capture
 * declines is not lost, it stays with the preview transform, which can pan and
 * therefore keeps framing the subject; only the recording gives up the extra
 * detail, which is the right way round for a camera whose job is to miss
 * nothing.
 */
export const CAPTURE_ZOOM_CEILING = 1.41;

/**
 * How far the capture may zoom, given everything that limits it at once.
 *
 * Kept here rather than inline in the hook so the decision can be exercised
 * directly: it is four bounds that interact, and a sweep that recomputed them
 * instead of calling this would go on passing after the real one changed.
 *
 * - `framed` is the padded box the *framing* uses, and bounds the crop that
 *   would push the subject out of shot.
 * - `tracked` is the raw detection the *tracker* compares, and bounds the jump
 *   in coordinates it can still follow. Bounding the padded box here would
 *   bound the wrong thing.
 * - {@link CAPTURE_ZOOM_CEILING} bounds how much of the room may be given up at
 *   all, whatever the subject allows.
 * - `headroom` is what the device's own lens can still do.
 */
export function captureZoomFor(
  framed: DetectionBox,
  tracked: DetectionBox,
  wantedScale: number,
  headroom: number,
  minOverlap: number = TRACK_OVERLAP_FLOOR,
): number {
  return Math.min(
    wantedScale,
    maxZoomKeepingInFrame(framed),
    maxZoomTrackable(tracked, minOverlap),
    CAPTURE_ZOOM_CEILING,
    headroom,
  );
}

export interface FramingOptions {
  /** Fraction of the view the target should occupy once framed (0–1). */
  coverage: number;
  /** Upper bound on magnification — caps how soft the digital zoom can get. */
  maxScale: number;
}

/**
 * Framing transform that centers `target` (view-space) and magnifies it to the
 * requested coverage.
 *
 * The pan is clamped so the scaled preview always covers the viewfinder: at
 * scale s the image overhangs by (s-1)/2 of the view on each side, so that is
 * exactly how far it may travel before an edge would come into view.
 */
export function computeFraming(
  target: DetectionBox,
  viewW: number,
  viewH: number,
  { coverage, maxScale }: FramingOptions,
): Framing {
  if (viewW <= 0 || viewH <= 0 || target.width <= 0 || target.height <= 0) {
    return NEUTRAL_FRAMING;
  }

  const rawScale = Math.min(coverage / target.width, coverage / target.height);
  const scale = Math.min(Math.max(rawScale, 1), maxScale);

  // Target centre, as an offset from the view centre, in px.
  const offsetX = (target.x + target.width / 2 - 0.5) * viewW;
  const offsetY = (target.y + target.height / 2 - 0.5) * viewH;

  const maxPanX = ((scale - 1) * viewW) / 2;
  const maxPanY = ((scale - 1) * viewH) / 2;

  return {
    scale,
    translateX: clamp(-scale * offsetX, -maxPanX, maxPanX),
    translateY: clamp(-scale * offsetY, -maxPanY, maxPanY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
