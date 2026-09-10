/**
 * Fitting the camera frame into the model's square input without distorting it.
 *
 * The resize plugin stretches whatever it is given into the size asked for, so
 * scaling a whole 16:9 frame straight to 320x320 squashed it: a standing person
 * came out 1.78x wider, relative to their height, than anything the detector was
 * trained on. Nothing about that failure is visible — the boxes are still boxes,
 * the scores are just lower — and it costs most on exactly the subjects that sit
 * near the threshold anyway: distant, dark, partly hidden.
 *
 * So the frame is scaled uniformly to fit inside the square and the rest is left
 * black, which is what EfficientDet's own preprocessing does (`resize_and_crop_
 * image` scales by `min(H/h, W/w)`, places the image at the origin and pads the
 * remainder). Placing it at the top-left rather than centring it is that same
 * convention, and it makes the mapping back a single factor per axis with no
 * offset — see `scaleX`/`scaleY` in `interpretDetections`.
 *
 * Everything here runs inside the frame processor, so every function is a
 * worklet (see `orientation.ts` for what that directive prevents).
 */

/** Size of the image inside the square input, in model-input pixels, uprighted. */
export interface Letterbox {
  width: number;
  height: number;
}

/**
 * The largest upright image of the given aspect ratio that fits in a `size`
 * square. `aspect` is width over height, as `uprightAspect` reports it.
 */
export function letterboxFor(aspect: number, size: number): Letterbox {
  'worklet';
  if (!(aspect > 0)) return { width: size, height: size };
  return aspect >= 1
    ? { width: size, height: Math.max(1, Math.round(size / aspect)) }
    : { width: Math.max(1, Math.round(size * aspect)), height: size };
}

/**
 * Copies the scaled frame into the top-left of a square model input, leaving the
 * remainder at zero.
 *
 * Allocates the input buffer per analysed frame on purpose: a buffer held at
 * module scope and reused would have to cross into the worklet runtime through
 * the closure, and what crosses is copied, not shared — so it would be a fresh
 * buffer per frame anyway, plus a copy of the whole thing on every call. The
 * resize plugin already allocates one of these per frame; this is the second.
 */
export function letterboxInto(
  scaled: Uint8Array,
  inner: Letterbox,
  size: number,
  channels: number,
): Uint8Array {
  'worklet';
  const input = new Uint8Array(size * size * channels);
  const rowBytes = inner.width * channels;
  // Full-width case (a landscape frame in a landscape square, or a square one):
  // the rows are already contiguous, so the whole image is one copy.
  if (inner.width === size) {
    input.set(scaled.subarray(0, rowBytes * inner.height), 0);
    return input;
  }
  const stride = size * channels;
  for (let row = 0; row < inner.height; row++) {
    input.set(scaled.subarray(row * rowBytes, row * rowBytes + rowBytes), row * stride);
  }
  return input;
}
