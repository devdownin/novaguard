import { DARK_MEAN, gammaFor, liftShadows, meanLuma, MIN_GAMMA, MIN_MEAN, TARGET_MEAN } from '../src/ml/lowLight';

const SIZE = 8;
/** A model input whose top-left `w`×`h` image is filled with `level`, the rest padding. */
function input(level: number, w = 8, h = 4): Uint8Array {
  const buffer = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < h; y++) buffer.fill(level, y * SIZE * 3, y * SIZE * 3 + w * 3);
  return buffer;
}

describe('low-light lift', () => {
  it('leaves a daylight frame untouched', () => {
    const frame = input(DARK_MEAN + 20);
    const before = frame.slice();
    expect(liftShadows(frame, 8, 4, SIZE, 3)).toBe(1);
    expect(frame).toEqual(before);
  });

  it('leaves a black frame alone too: there is only noise to amplify', () => {
    expect(gammaFor(MIN_MEAN - 1)).toBe(1);
    expect(liftShadows(input(MIN_MEAN - 1), 8, 4, SIZE, 3)).toBe(1);
  });

  it('brings a dark frame up to the target mean, and only its image', () => {
    const frame = input(30, 6, 4);
    const gamma = liftShadows(frame, 6, 4, SIZE, 3);
    expect(gamma).toBeLessThan(1);
    expect(meanLuma(frame, 6, 4, SIZE, 3)).toBeCloseTo(TARGET_MEAN, -1);
    // Padding right of the image and below it is still black.
    expect(frame[6 * 3]).toBe(0);
    expect(frame[4 * SIZE * 3]).toBe(0);
  });

  it('never applies a stronger curve than the floor', () => {
    expect(gammaFor(MIN_MEAN)).toBe(MIN_GAMMA);
  });
});
