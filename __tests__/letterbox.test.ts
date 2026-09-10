/**
 * Fitting the frame into the model's square input without distorting it.
 *
 * The failure this replaces is invisible from the outside: a squashed frame
 * still produces boxes, they are just placed on a picture the detector was
 * never trained on. So the geometry is asserted here rather than eyeballed —
 * both halves of it, since a correct letterbox with the wrong inverse puts
 * every box in the wrong place, which looks exactly like a broken detector.
 *
 * @format
 */

import { letterboxFor, letterboxInto } from '../src/ml/letterbox';
import { interpretDetections } from '../src/ml/interpretDetections';

const SIZE = 320;
const PERSON = 0;

describe('letterboxFor', () => {
  it('fills the square for a square frame', () => {
    expect(letterboxFor(1, SIZE)).toEqual({ width: SIZE, height: SIZE });
  });

  it('keeps a portrait 16:9 frame at its own aspect ratio', () => {
    const inner = letterboxFor(9 / 16, SIZE);
    expect(inner).toEqual({ width: 180, height: 320 });
    expect(inner.width / inner.height).toBeCloseTo(9 / 16, 2);
  });

  it('keeps a landscape 16:9 frame at its own aspect ratio', () => {
    const inner = letterboxFor(16 / 9, SIZE);
    expect(inner).toEqual({ width: 320, height: 180 });
    expect(inner.width / inner.height).toBeCloseTo(16 / 9, 2);
  });

  it('never exceeds the input on either axis, at any aspect', () => {
    for (const aspect of [0.1, 0.5625, 0.75, 1, 1.333, 1.777, 4]) {
      const inner = letterboxFor(aspect, SIZE);
      expect(inner.width).toBeLessThanOrEqual(SIZE);
      expect(inner.height).toBeLessThanOrEqual(SIZE);
      expect(Math.max(inner.width, inner.height)).toBe(SIZE);
    }
  });

  it('falls back to the full square rather than a zero-sized image', () => {
    // `uprightAspect` returns 1 for a degenerate frame, but a NaN reaching here
    // would otherwise produce a buffer the model cannot be given at all.
    expect(letterboxFor(0, SIZE)).toEqual({ width: SIZE, height: SIZE });
    expect(letterboxFor(NaN, SIZE)).toEqual({ width: SIZE, height: SIZE });
  });
});

describe('letterboxInto', () => {
  /** A scaled image whose every pixel is `value`, at the given inner size. */
  const filled = (inner: { width: number; height: number }, value: number) =>
    new Uint8Array(inner.width * inner.height * 3).fill(value);

  it('produces a buffer of exactly the model input size', () => {
    const inner = letterboxFor(9 / 16, SIZE);
    expect(letterboxInto(filled(inner, 200), inner, SIZE, 3)).toHaveLength(SIZE * SIZE * 3);
  });

  it('places a portrait image against the left edge and pads the right', () => {
    const inner = letterboxFor(9 / 16, SIZE);          // 180 x 320
    const input = letterboxInto(filled(inner, 200), inner, SIZE, 3);

    // Row 0: image up to x = 179, padding from x = 180.
    expect(input[(inner.width - 1) * 3]).toBe(200);
    expect(input[inner.width * 3]).toBe(0);
    // Last row, same story — the stride has to be the square's, not the image's.
    const lastRow = (SIZE - 1) * SIZE * 3;
    expect(input[lastRow + (inner.width - 1) * 3]).toBe(200);
    expect(input[lastRow + inner.width * 3]).toBe(0);
  });

  it('places a landscape image against the top edge and pads the bottom', () => {
    const inner = letterboxFor(16 / 9, SIZE);          // 320 x 180
    const input = letterboxInto(filled(inner, 200), inner, SIZE, 3);

    expect(input[(inner.height - 1) * SIZE * 3]).toBe(200);
    expect(input[inner.height * SIZE * 3]).toBe(0);
  });

  it('copies every pixel of the image, and pads everything else', () => {
    const inner = letterboxFor(9 / 16, SIZE);
    const input = letterboxInto(filled(inner, 200), inner, SIZE, 3);
    const copied = input.reduce((n, byte) => (byte === 200 ? n + 1 : n), 0);
    expect(copied).toBe(inner.width * inner.height * 3);
  });

  it('writes the whole square when nothing needs padding', () => {
    const inner = letterboxFor(1, SIZE);
    const input = letterboxInto(filled(inner, 200), inner, SIZE, 3);
    expect(input.every(byte => byte === 200)).toBe(true);
  });
});

describe('round trip', () => {
  /** The model's outputs for one box, expressed in its square input space. */
  const outputs = (corners: [number, number, number, number]) => [
    Float32Array.from(corners),
    Float32Array.from([PERSON]),
    Float32Array.from([0.9]),
    Float32Array.from([1]),
  ];

  it('maps a box back onto the frame the letterbox came from', () => {
    // A portrait 16:9 frame occupies the left 180/320 of the square. A subject
    // filling the middle third of the *frame* horizontally therefore lands
    // between 0.333 and 0.667 of that 180 — 0.1875 and 0.375 of the square.
    const inner = letterboxFor(9 / 16, SIZE);
    const [d] = interpretDetections(outputs([0.2, 0.1875, 0.8, 0.375]), {
      detectPerson: true,
      detectAnimal: true,
      floorConfidence: 0.3,
      scaleX: SIZE / inner.width,
      scaleY: SIZE / inner.height,
    });

    expect(d.box.x).toBeCloseTo(1 / 3, 2);
    expect(d.box.x + d.box.width).toBeCloseTo(2 / 3, 2);
    // The unpadded axis is untouched.
    expect(d.box.y).toBeCloseTo(0.2);
    expect(d.box.height).toBeCloseTo(0.6);
  });

  it('still clamps a box the padding would push past the frame edge', () => {
    const inner = letterboxFor(9 / 16, SIZE);
    const [d] = interpretDetections(outputs([0.1, 0.5, 0.9, 0.9]), {
      detectPerson: true,
      detectAnimal: true,
      floorConfidence: 0.3,
      scaleX: SIZE / inner.width,
      scaleY: SIZE / inner.height,
    });

    // 0.9 of the square is well inside the padding; the frame ends at 0.5625.
    expect(d.box.x + d.box.width).toBe(1);
  });
});
