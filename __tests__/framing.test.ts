/**
 * @format
 */

import {
  boxInZoomedFrame,
  CAPTURE_ZOOM_CEILING,
  captureZoomFor, computeFraming, containedFraction, maxZoomKeepingInFrame, maxZoomTrackable,
  NEUTRAL_FRAMING, padBox, smoothBox, subjectBox, TRACK_OVERLAP_FLOOR, unionBox,
} from '../src/camera/framing';
import { DEFAULT_TRACKER_OPTIONS, iou } from '../src/ml/tracker';
import { DetectionBox } from '../src/ml/types';

const VIEW_W = 360;
const VIEW_H = 560;

describe('unionBox', () => {
  it('returns null for an empty list', () => {
    expect(unionBox([])).toBeNull();
  });

  it('wraps every box', () => {
    const union = unionBox([
      { x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
      { x: 0.5, y: 0.1, width: 0.2, height: 0.4 },
    ]);
    expect(union).toEqual({ x: 0.1, y: 0.1, width: 0.6, height: 0.4 });
  });
});

describe('padBox', () => {
  it('grows the box on every side', () => {
    const box = padBox({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 0.5);
    expect(box.x).toBeCloseTo(0.3);
    expect(box.y).toBeCloseTo(0.3);
    expect(box.width).toBeCloseTo(0.4);
    expect(box.height).toBeCloseTo(0.4);
  });

  it('never leaves the 0–1 range', () => {
    const box = padBox({ x: 0.05, y: 0.9, width: 0.2, height: 0.2 }, 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeLessThanOrEqual(1);
  });
});

describe('smoothBox', () => {
  it('passes the first sample through untouched', () => {
    const next = { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };
    expect(smoothBox(null, next, 0.25)).toBe(next);
  });

  it('moves only part of the way towards the new sample', () => {
    const previous = { x: 0, y: 0, width: 0.2, height: 0.2 };
    const next = { x: 1, y: 1, width: 0.2, height: 0.2 };
    expect(smoothBox(previous, next, 0.25).x).toBeCloseTo(0.25);
  });

  it('converges on the target after repeated samples', () => {
    const target = { x: 0.8, y: 0.8, width: 0.2, height: 0.2 };
    let box = { x: 0, y: 0, width: 0.2, height: 0.2 };
    for (let i = 0; i < 60; i++) box = smoothBox(box, target, 0.25);
    expect(box.x).toBeCloseTo(0.8, 3);
  });
});

/**
 * The capture zoom is the only magnification that reaches the recorded file —
 * a React Native transform scales the preview view and nothing else. It is also
 * a centre crop with no pan, which is the whole difficulty.
 */
describe('maxZoomKeepingInFrame', () => {
  it('lets a centred subject zoom as far as it likes', () => {
    const centred = { x: 0.45, y: 0.45, width: 0.1, height: 0.1 };
    // Furthest edge is 0.05 from centre, so the crop may shrink to a tenth.
    expect(maxZoomKeepingInFrame(centred)).toBeCloseTo(10);
  });

  it('refuses to zoom at all on a subject against the edge', () => {
    // Cropping here would remove exactly the thing being recorded.
    expect(maxZoomKeepingInFrame({ x: 0, y: 0.4, width: 0.2, height: 0.2 })).toBe(1);
    expect(maxZoomKeepingInFrame({ x: 0.4, y: 0.8, width: 0.2, height: 0.2 })).toBe(1);
  });

  it('is bounded by whichever axis runs out first', () => {
    // Comfortable horizontally, close to the top edge: the vertical axis decides.
    const tall = { x: 0.45, y: 0.05, width: 0.1, height: 0.1 };
    expect(maxZoomKeepingInFrame(tall)).toBeCloseTo(0.5 / 0.45);
  });

  it('never answers below 1, which would mean zooming out past the sensor', () => {
    expect(maxZoomKeepingInFrame({ x: 0, y: 0, width: 1, height: 1 })).toBe(1);
    expect(maxZoomKeepingInFrame({ x: -0.2, y: 0.4, width: 0.3, height: 0.2 })).toBe(1);
  });

  it('holds: the box stays inside the crop at the zoom it returns', () => {
    const boxes = [
      { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
      { x: 0.2, y: 0.3, width: 0.15, height: 0.25 },
      { x: 0.62, y: 0.1, width: 0.2, height: 0.3 },
    ];
    for (const box of boxes) {
      const zoom = Math.min(maxZoomKeepingInFrame(box), 50);
      const visible = { from: 0.5 - 1 / (2 * zoom), to: 0.5 + 1 / (2 * zoom) };
      // The property the whole bound exists for, checked rather than assumed.
      expect(box.x).toBeGreaterThanOrEqual(visible.from - 1e-9);
      expect(box.y).toBeGreaterThanOrEqual(visible.from - 1e-9);
      expect(box.x + box.width).toBeLessThanOrEqual(visible.to + 1e-9);
      expect(box.y + box.height).toBeLessThanOrEqual(visible.to + 1e-9);
    }
  });
});

/**
 * A capture zoom is not a movement — nobody went anywhere — but the tracker
 * cannot tell: every box it holds is expressed in a frame that has just been
 * recropped, so the same subject arrives somewhere else on the next frame. Past
 * a certain step `updateTracks` stops recognising it, drops the track, and the
 * replacement needs `confirmAfter` frames before anything is confirmed again.
 */
describe('maxZoomTrackable', () => {
  const FLOOR = TRACK_OVERLAP_FLOOR;
  const overlapAfter = (box: DetectionBox, zoom: number) => iou(box, boxInZoomedFrame(box, zoom));

  it('sits above the threshold the tracker actually applies', () => {
    // The floor is deliberately clear of it: a subject is usually moving too,
    // and that motion spends overlap of its own. If someone raises the
    // tracker's threshold past the floor, this is what says so.
    expect(FLOOR).toBeGreaterThan(DEFAULT_TRACKER_OPTIONS.iouThreshold);
  });

  it('lands on the zoom where the overlap runs out', () => {
    const box = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const limit = maxZoomTrackable(box, FLOOR);

    expect(overlapAfter(box, limit)).toBeGreaterThanOrEqual(FLOOR - 1e-6);
    // And it is the *largest* such zoom, not a timid one.
    expect(overlapAfter(box, limit + 0.05)).toBeLessThan(FLOOR);
  });

  it('allows a centred subject more than an off-centre one', () => {
    // A centred box only grows; an off-centre one is translated as well, which
    // costs overlap far faster. That asymmetry is why a flat ceiling cannot work.
    const centred = maxZoomTrackable({ x: 0.43, y: 0.43, width: 0.14, height: 0.14 }, FLOOR);
    const offCentre = maxZoomTrackable({ x: 0.15, y: 0.43, width: 0.14, height: 0.14 }, FLOOR);

    expect(centred).toBeGreaterThan(offCentre);
  });

  it('never asks for less than no zoom at all', () => {
    expect(maxZoomTrackable({ x: 0, y: 0, width: 0, height: 0 }, FLOOR)).toBe(1);
    expect(maxZoomTrackable({ x: 0.02, y: 0.02, width: 0.04, height: 0.04 }, FLOOR))
      .toBeGreaterThanOrEqual(1);
  });

  /**
   * The property the whole bound exists for, checked across the space rather
   * than at the one point that first suggested a flat ceiling would do. It
   * would not: a centred box keeps `1/z²` of itself and survives to 2x, while a
   * face at (0.19, 0.19) stops overlapping its old position at barely 1.5x.
   */
  it('keeps every subject matchable, wherever it is in frame', () => {
    const sizes = [0.10, 0.14, 0.18, 0.24];
    let worst = 1;

    for (const size of sizes) {
      for (let x = 0; x <= 1 - size; x += 0.02) {
        for (let y = 0; y <= 1 - size; y += 0.02) {
          const box = { x, y, width: size, height: size };
          const framed = padBox(box, 0.25);
          const zoom = captureZoomFor(
            framed,
            box,
            computeFraming(framed, 360, 640, { coverage: 0.45, maxScale: 2.8 }).scale,
            Infinity,
          );
          if (zoom <= 1) continue;
          worst = Math.min(worst, overlapAfter(box, zoom));
        }
      }
    }

    expect(worst).toBeGreaterThanOrEqual(DEFAULT_TRACKER_OPTIONS.iouThreshold);
  });
});

describe('boxInZoomedFrame', () => {
  it('leaves the box alone at 1x', () => {
    const box = { x: 0.3, y: 0.4, width: 0.2, height: 0.1 };
    expect(boxInZoomedFrame(box, 1)).toEqual(box);
  });

  it('grows the box by the factor the camera already applied', () => {
    const centred = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const zoomed = boxInZoomedFrame(centred, 2);
    expect(zoomed.x).toBeCloseTo(0.3);
    expect(zoomed.y).toBeCloseTo(0.3);
    expect(zoomed.width).toBeCloseTo(0.4);
    expect(zoomed.height).toBeCloseTo(0.4);
  });

  it('pushes an off-centre box further out, as a centre crop does', () => {
    const left = { x: 0.1, y: 0.45, width: 0.1, height: 0.1 };
    const zoomed = boxInZoomedFrame(left, 2);
    // It was 0.35 left of centre; at 2x the crop makes that 0.7.
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(0.5 - 0.7);
  });

  it('composes with computeFraming instead of multiplying with it', () => {
    const target = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const options = { coverage: 0.8, maxScale: 8 };
    const withoutCameraZoom = computeFraming(target, 400, 400, options);

    // Half the magnification done by the camera; the transform must ask for the
    // other half, so that camera x transform lands back on the same total.
    const cameraZoom = 2;
    const residual = computeFraming(boxInZoomedFrame(target, cameraZoom), 400, 400, options);

    expect(residual.scale * cameraZoom).toBeCloseTo(withoutCameraZoom.scale);
  });
});

describe('computeFraming', () => {
  const opts = { coverage: 0.45, maxScale: 2.8 };

  it('is neutral for a degenerate target', () => {
    expect(computeFraming({ x: 0, y: 0, width: 0, height: 0 }, VIEW_W, VIEW_H, opts))
      .toEqual(NEUTRAL_FRAMING);
  });

  it('is neutral before the view has been measured', () => {
    expect(computeFraming({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 }, 0, 0, opts))
      .toEqual(NEUTRAL_FRAMING);
  });

  it('never zooms out below 1x, even for a target larger than the coverage', () => {
    const { scale } = computeFraming({ x: 0, y: 0, width: 1, height: 1 }, VIEW_W, VIEW_H, opts);
    expect(scale).toBe(1);
  });

  it('caps magnification at maxScale for a tiny target', () => {
    const { scale } = computeFraming({ x: 0.49, y: 0.49, width: 0.02, height: 0.02 }, VIEW_W, VIEW_H, opts);
    expect(scale).toBe(opts.maxScale);
  });

  it('magnifies a small target towards the requested coverage', () => {
    const { scale } = computeFraming({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, VIEW_W, VIEW_H, opts);
    expect(scale).toBeCloseTo(0.45 / 0.2);
  });

  it('needs no pan for a centred target', () => {
    const { translateX, translateY } = computeFraming(
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, VIEW_W, VIEW_H, opts,
    );
    expect(translateX).toBeCloseTo(0);
    expect(translateY).toBeCloseTo(0);
  });

  it('pans towards an off-centre target', () => {
    // Target sits left of centre, so the image must slide right (positive X).
    const { translateX } = computeFraming(
      { x: 0.1, y: 0.4, width: 0.2, height: 0.2 }, VIEW_W, VIEW_H, opts,
    );
    expect(translateX).toBeGreaterThan(0);
  });

  it('never pans far enough to expose an edge', () => {
    // A tiny target in the extreme corner asks for far more pan than is allowed.
    const { scale, translateX, translateY } = computeFraming(
      { x: 0, y: 0, width: 0.03, height: 0.03 }, VIEW_W, VIEW_H, opts,
    );
    expect(Math.abs(translateX)).toBeLessThanOrEqual(((scale - 1) * VIEW_W) / 2 + 1e-9);
    expect(Math.abs(translateY)).toBeLessThanOrEqual(((scale - 1) * VIEW_H) / 2 + 1e-9);
  });

  it('has no pan to clamp when it is not zoomed in', () => {
    const { scale, translateX, translateY } = computeFraming(
      { x: 0, y: 0, width: 1, height: 1 }, VIEW_W, VIEW_H, opts,
    );
    expect(scale).toBe(1);
    expect(translateX).toBeCloseTo(0);
    expect(translateY).toBeCloseTo(0);
  });
});

describe('containedFraction', () => {
  const outer: DetectionBox = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

  it('is 1 for a box entirely inside', () => {
    expect(containedFraction({ x: 0.3, y: 0.3, width: 0.1, height: 0.1 }, outer)).toBeCloseTo(1);
  });

  it('is 0 for a box that does not touch', () => {
    expect(containedFraction({ x: 0.7, y: 0.7, width: 0.1, height: 0.1 }, outer)).toBe(0);
  });

  it('measures the overlap against the inner box, not the outer one', () => {
    // Half of this sits left of `outer`. Measured against the outer box the
    // answer would be a small fraction instead of a half.
    expect(containedFraction({ x: 0.1, y: 0.3, width: 0.2, height: 0.1 }, outer)).toBeCloseTo(0.5);
  });

  it('is 0 for a box with no area', () => {
    expect(containedFraction({ x: 0.3, y: 0.3, width: 0, height: 0.1 }, outer)).toBe(0);
  });
});

/**
 * The subject of the cinematic move. Every answer here is a person box (or a
 * person unioned with their own face) — never a face on its own, which is the
 * whole reason this function exists.
 */
describe('subjectBox', () => {
  const near: DetectionBox = { x: 0.6, y: 0.2, width: 0.3, height: 0.7 };
  const far: DetectionBox = { x: 0.1, y: 0.35, width: 0.12, height: 0.3 };
  const farFace: DetectionBox = { x: 0.13, y: 0.36, width: 0.06, height: 0.06 };

  it('has nothing to frame without a person, whatever the faces say', () => {
    expect(subjectBox([], [farFace])).toBeNull();
  });

  it('takes the nearest person when no face is found', () => {
    expect(subjectBox([far, near], [])).toEqual(near);
  });

  it('prefers the person a face was found on, near or far', () => {
    expect(subjectBox([near, far], [farFace])).toMatchObject({ x: far.x, width: far.width });
  });

  it('ignores a face that belongs to nobody in the list', () => {
    const stray: DetectionBox = { x: 0.02, y: 0.02, width: 0.05, height: 0.05 };
    expect(subjectBox([far, near], [stray])).toEqual(near);
  });

  it('takes in a head the person box clipped', () => {
    const headless: DetectionBox = { x: 0.4, y: 0.3, width: 0.2, height: 0.6 };
    // Mostly inside them, but rising above the box — a detection that cut the
    // head off. Framing the person alone would frame them without it.
    const face: DetectionBox = { x: 0.45, y: 0.25, width: 0.1, height: 0.1 };
    const subject = subjectBox([headless], [face])!;
    expect(subject.y).toBeCloseTo(0.25);
    expect(subject.y + subject.height).toBeCloseTo(0.9);
  });

  it('keeps the whole body when the face sits inside it', () => {
    const face: DetectionBox = { x: 0.7, y: 0.25, width: 0.08, height: 0.08 };
    const subject = subjectBox([near], [face])!;
    // Same box, to floating-point noise: a union with something already inside
    // adds nothing.
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(subject[key]).toBeCloseTo(near[key], 9);
    }
  });
});

/**
 * How much of the room the capture is allowed to stop watching.
 *
 * A capture zoom of `z` keeps `1/z²` of the sensor area, and the crop reaches
 * the detection model as well as the file: what it drops is neither recorded
 * nor seen. The subject's own bounds say nothing about that — a small, dead
 * centre subject lets the crop go as far as the tracker can follow, which was
 * 1.77x, or two thirds of the room gone for the length of the close shot.
 */
describe('the ceiling on what the capture may give up', () => {
  // Tiny and dead centre: every other bound is wide open here, so the ceiling
  // is the only thing that can answer.
  const centred: DetectionBox = { x: 0.48, y: 0.48, width: 0.04, height: 0.04 };

  it('never gives up more than half the frame area', () => {
    const zoom = captureZoomFor(centred, centred, 8, 8);
    expect(zoom).toBeLessThanOrEqual(CAPTURE_ZOOM_CEILING);
    expect(1 / (zoom * zoom)).toBeGreaterThanOrEqual(0.5);
  });

  it('still lets the capture zoom at all', () => {
    // A ceiling that refused everything would be a way of deleting the feature
    // rather than bounding it.
    expect(captureZoomFor(centred, centred, 8, 8)).toBeGreaterThan(1.2);
  });

  it('does not raise a subject that allows less', () => {
    // Against an edge, the subject's own bound is far below the ceiling and is
    // the one that has to win.
    const edge: DetectionBox = { x: 0, y: 0.4, width: 0.2, height: 0.2 };
    expect(captureZoomFor(edge, edge, 8, 8)).toBeLessThan(1.1);
  });

  it('does not raise a device that can do less', () => {
    expect(captureZoomFor(centred, centred, 8, 1.2)).toBeCloseTo(1.2);
  });
});
