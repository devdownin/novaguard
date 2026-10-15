/**
 * Brightening a dark model input before inference.
 *
 * EfficientDet was trained on daylight photographs, and a room at night comes
 * out of the sensor as a frame whose subjects sit in the bottom few dozen grey
 * levels: the shapes are there, the contrast the detector keys on is not.
 * Low-light boost exists on some cameras only (`supportsLowLightBoost`), so on
 * the others a dark scene was simply a scene the detector could not read.
 *
 * A gamma curve chosen per frame lifts the mean of the scaled image to
 * `TARGET_MEAN`, spreading the shadows over the levels the model knows. Only
 * the model's input is touched — never the recording — and only below
 * `DARK_MEAN`, so a daylight frame is passed through untouched and costs one
 * sampling pass. Under `MIN_MEAN` there is nothing left to recover but noise,
 * and amplifying noise into shapes is how a dark room starts filming itself.
 *
 * Everything here runs inside the frame processor, so every function is a
 * worklet (see `orientation.ts` for what that directive prevents).
 */

/** Mean luma (0–255) under which a frame is brightened. */
export const DARK_MEAN = 70;
/** Mean luma the curve aims for. */
export const TARGET_MEAN = 110;
/** Mean luma under which nothing is attempted: noise, not a scene. */
export const MIN_MEAN = 8;
/** Strongest curve allowed, whatever the mean. */
export const MIN_GAMMA = 0.4;
/** Every n-th pixel is sampled for the mean; the image is smooth at this scale. */
const SAMPLE_STEP = 4;

/** Mean luma of the scaled image in the top-left `width`×`height` of a `size`-wide RGB input. */
export function meanLuma(input: Uint8Array, width: number, height: number, size: number, channels: number): number {
  'worklet';
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    const row = y * size * channels;
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const i = row + x * channels;
      sum += 0.299 * input[i] + 0.587 * input[i + 1] + 0.114 * input[i + 2];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** The gamma that takes `mean` to `TARGET_MEAN`, or 1 when the frame is left alone. */
export function gammaFor(mean: number): number {
  'worklet';
  if (mean >= DARK_MEAN || mean < MIN_MEAN) return 1;
  return Math.max(MIN_GAMMA, Math.log(TARGET_MEAN / 255) / Math.log(mean / 255));
}

/**
 * Brightens the image part of the model input in place when it is dark, and
 * returns the gamma applied (1 for none). The padding stays black: gamma keeps
 * 0 at 0, and it is not walked anyway.
 */
export function liftShadows(input: Uint8Array, width: number, height: number, size: number, channels: number): number {
  'worklet';
  const gamma = gammaFor(meanLuma(input, width, height, size, channels));
  if (gamma === 1) return 1;
  const curve = new Uint8Array(256);
  for (let level = 0; level < 256; level++) curve[level] = Math.round(255 * Math.pow(level / 255, gamma));
  const rowBytes = width * channels;
  for (let y = 0; y < height; y++) {
    const start = y * size * channels;
    for (let i = start; i < start + rowBytes; i++) input[i] = curve[input[i]];
  }
  return gamma;
}

/** Cells per side of the scene signature handed to the tamper watch. */
export const SCENE_GRID = 8;

/**
 * The scene as the JS side watches it: `[mean luma, ...SCENE_GRID² cell means]`,
 * taken from the model input *before* it is brightened. A flat array of
 * numbers, because that is what crosses back from the worklet runtime intact.
 */
export function sceneSample(input: Uint8Array, width: number, height: number, size: number, channels: number): number[] {
  'worklet';
  const cells = SCENE_GRID * SCENE_GRID;
  const sums: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < cells; i++) { sums.push(0); counts.push(0); }
  let total = 0;
  let n = 0;
  for (let y = 0; y < height; y += SAMPLE_STEP) {
    const row = y * size * channels;
    const cellRow = Math.floor((y * SCENE_GRID) / height) * SCENE_GRID;
    for (let x = 0; x < width; x += SAMPLE_STEP) {
      const i = row + x * channels;
      const v = 0.299 * input[i] + 0.587 * input[i + 1] + 0.114 * input[i + 2];
      const cell = cellRow + Math.floor((x * SCENE_GRID) / width);
      sums[cell] += v;
      counts[cell]++;
      total += v;
      n++;
    }
  }
  const out: number[] = [n > 0 ? total / n : 0];
  for (let i = 0; i < cells; i++) out.push(counts[i] > 0 ? sums[i] / counts[i] : 0);
  return out;
}
