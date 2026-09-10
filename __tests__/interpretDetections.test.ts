/**
 * Decoding of the model's four output tensors.
 *
 * This is the seam where a wrong assumption is invisible: the boxes still look
 * plausible, they are just in the wrong place or for the wrong class. The
 * tensor shapes and the class indices used here were read off the bundled
 * efficientdet-lite0.tflite itself.
 *
 * @format
 */

import { interpretDetections } from '../src/ml/interpretDetections';
import { COCO_LABELS } from '../src/ml/labels';

const PERSON = 0;
const DOG = 17;
const CAR = 2;

interface Det {
  /** (yMin, xMin, yMax, xMax), normalized to the uprighted frame. */
  corners: [number, number, number, number];
  classIndex: number;
  score: number;
}

/** Packs detections into the model's real output layout. */
function outputs(dets: Det[], count = dets.length): Float32Array[] {
  return [
    Float32Array.from(dets.flatMap(d => d.corners)),
    Float32Array.from(dets.map(d => d.classIndex)),
    Float32Array.from(dets.map(d => d.score)),
    Float32Array.from([count]),
  ];
}

// No letterbox padding: these cases are about decoding, not about geometry —
// `letterbox.test.ts` owns the mapping back out of the padded square.
const BOTH = {
  detectPerson: true, detectAnimal: true, floorConfidence: 0.5, scaleX: 1, scaleY: 1,
};
const det = (corners: Det['corners'], classIndex = PERSON, score = 0.9): Det =>
  ({ corners, classIndex, score });

describe('label mapping', () => {
  it('agrees with the bundled model: person is index 0', () => {
    // Swapping in a model whose labelmap has a leading '???' shifts every
    // class by one and silently kills detection.
    expect(COCO_LABELS[PERSON]).toBe('person');
    expect(COCO_LABELS[DOG]).toBe('dog');
    expect(COCO_LABELS[CAR]).toBe('car');
  });

  it('reads a person and a dog as their app-level kinds', () => {
    const results = interpretDetections(
      outputs([det([0.1, 0.1, 0.5, 0.3], PERSON), det([0.6, 0.6, 0.8, 0.8], DOG)]),
      BOTH,
    );
    expect(results.map(r => r.kind).sort()).toEqual(['Animal', 'Personne']);
  });

  it('ignores classes the app does not care about', () => {
    expect(interpretDetections(outputs([det([0.1, 0.1, 0.5, 0.5], CAR)]), BOTH)).toEqual([]);
  });
});

describe('box geometry', () => {
  it('reads the corners in the model\'s (yMin, xMin, yMax, xMax) order', () => {
    const [d] = interpretDetections(outputs([det([0.2, 0.1, 0.8, 0.4])]), BOTH);
    expect(d.box).toEqual({
      x: expect.closeTo(0.1), y: expect.closeTo(0.2),
      width: expect.closeTo(0.3), height: expect.closeTo(0.6),
    });
  });

  it('keeps a subject clipped by the left edge inside the frame', () => {
    // EfficientDet routinely emits corners outside 0..1 for a subject the
    // frame cuts off. Clamping origin and size separately — which this did —
    // made the box 0.33 wide where only 0.25 of it is visible.
    const [d] = interpretDetections(outputs([det([0.2, -0.08, 0.9, 0.25])]), BOTH);
    expect(d.box.x).toBe(0);
    expect(d.box.width).toBeCloseTo(0.25);
    expect(d.box.x + d.box.width).toBeCloseTo(0.25);
  });

  it('keeps a subject leaving the right edge inside the frame', () => {
    const [d] = interpretDetections(outputs([det([0.1, 0.8, 0.95, 1.14])]), BOTH);
    expect(d.box.x + d.box.width).toBeCloseTo(1);
    expect(d.box.width).toBeCloseTo(0.2);
  });

  it('never returns a box reaching outside the frame, on any edge', () => {
    const [d] = interpretDetections(outputs([det([-0.3, -0.2, 1.4, 1.2])]), BOTH);
    expect(d.box.x).toBeGreaterThanOrEqual(0);
    expect(d.box.y).toBeGreaterThanOrEqual(0);
    expect(d.box.x + d.box.width).toBeLessThanOrEqual(1);
    expect(d.box.y + d.box.height).toBeLessThanOrEqual(1);
  });

  it('drops a box that is entirely off-frame instead of collapsing it to nothing', () => {
    // It used to come back with width and height 0. A box with no area cannot
    // be associated with anything — `iou` reads 0 and the tracker's proximity
    // fallback refuses a zero area — so it opened a fresh track on every frame,
    // and at "Basse", where one look confirms, that is a recording.
    expect(interpretDetections(outputs([det([1.2, 1.1, 1.6, 1.5])]), BOTH)).toEqual([]);
  });

  it('drops a sliver too thin to be anything the model can have seen', () => {
    // A hundredth of the frame is four pixels of the detector's own input.
    expect(interpretDetections(outputs([det([0.40, 0.30, 0.95, 0.304])]), BOTH)).toEqual([]);
  });

  it('keeps a subject that is small but real', () => {
    // The whole point of the 448 px model is the far end of a garden; a floor
    // that reached this far would undo it.
    const [d] = interpretDetections(outputs([det([0.40, 0.30, 0.46, 0.32])]), BOTH);
    expect(d.box.width).toBeCloseTo(0.02);
    expect(d.box.height).toBeCloseTo(0.06);
  });
});

describe('filtering', () => {
  it('drops anything under the association floor', () => {
    const results = interpretDetections(
      outputs([det([0.1, 0.1, 0.4, 0.4], PERSON, 0.95), det([0.5, 0.5, 0.7, 0.7], PERSON, 0.42)]),
      BOTH,
    );
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBeCloseTo(0.95);
  });

  it('honours the person and animal switches independently', () => {
    const both = outputs([det([0.1, 0.1, 0.4, 0.4], PERSON), det([0.5, 0.5, 0.7, 0.7], DOG)]);
    expect(interpretDetections(both, { ...BOTH, detectAnimal: false })
      .map(r => r.kind)).toEqual(['Personne']);
    expect(interpretDetections(both, { ...BOTH, detectPerson: false })
      .map(r => r.kind)).toEqual(['Animal']);
    expect(interpretDetections(both, { ...BOTH, detectPerson: false, detectAnimal: false }))
      .toEqual([]);
  });

  it('reads only as many slots as the model says are valid', () => {
    // The tensors are fixed-size; everything past numDetections is stale.
    const results = interpretDetections(
      outputs([det([0.1, 0.1, 0.4, 0.4]), det([0.5, 0.5, 0.7, 0.7])], 1),
      BOTH,
    );
    expect(results).toHaveLength(1);
  });

  it('returns nothing when the model reports no detections', () => {
    expect(interpretDetections(outputs([det([0.1, 0.1, 0.4, 0.4])], 0), BOTH)).toEqual([]);
  });

  it('orders results by confidence, so the primary subject comes first', () => {
    const results = interpretDetections(
      outputs([
        det([0.1, 0.1, 0.3, 0.3], PERSON, 0.6),
        det([0.4, 0.4, 0.6, 0.6], PERSON, 0.94),
        det([0.7, 0.7, 0.9, 0.9], PERSON, 0.78),
      ]),
      BOTH,
    );
    expect(results.map(r => r.confidence)).toEqual([
      expect.closeTo(0.94), expect.closeTo(0.78), expect.closeTo(0.6),
    ]);
  });
});

describe('cross-class suppression', () => {
  // The model's own NMS runs per class, so one subject can come back under two
  // labels. Each spurious Animal would be its own track, its own alert and its
  // own history entry — and the low floor makes those weak second labels far
  // more common than they were.
  const BEAR = 22;

  it('keeps only the stronger label when a person is also read as an animal', () => {
    const results = interpretDetections(
      outputs([
        det([0.2, 0.3, 0.9, 0.5], PERSON, 0.71),
        det([0.21, 0.31, 0.88, 0.49], BEAR, 0.54),
      ]),
      BOTH,
    );
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('Personne');
  });

  it('drops the person instead when the animal is the stronger reading', () => {
    const results = interpretDetections(
      outputs([
        det([0.2, 0.3, 0.9, 0.5], PERSON, 0.55),
        det([0.21, 0.31, 0.88, 0.49], DOG, 0.83),
      ]),
      BOTH,
    );
    expect(results.map(r => r.kind)).toEqual(['Animal']);
  });

  it('leaves a person and an animal that are genuinely both there', () => {
    // A dog beside its owner overlaps hardly at all; suppressing that would
    // lose half of what the app is asked to watch for.
    const results = interpretDetections(
      outputs([
        det([0.2, 0.1, 0.9, 0.3], PERSON, 0.88),
        det([0.7, 0.4, 0.95, 0.6], DOG, 0.62),
      ]),
      BOTH,
    );
    expect(results.map(r => r.kind).sort()).toEqual(['Animal', 'Personne']);
  });

  it('never suppresses within a kind — two people standing close both count', () => {
    const results = interpretDetections(
      outputs([
        det([0.2, 0.3, 0.9, 0.5], PERSON, 0.9),
        det([0.21, 0.31, 0.88, 0.49], PERSON, 0.8),
      ]),
      BOTH,
    );
    expect(results).toHaveLength(2);
  });
});
