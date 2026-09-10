import { Orientation } from 'react-native-vision-camera';

export type Rotation = '0deg' | '90deg' | '180deg' | '270deg';

/**
 * Everything here runs inside the camera's frame processor, so every function
 * is a worklet.
 *
 * This is not decoration. The worklets compiler collects the free variables a
 * worklet references into its `__closure`, and a plain JS function put there is
 * replaced by a stub that throws "Regular javascript function '<name>' cannot
 * be shared" the first time it is called. Calling `uprightRotation` from the
 * frame processor without this directive therefore killed the process on the
 * very first frame — the preview appeared, then the app died. `__tests__/
 * workletSafety.test.ts` compiles the real worklets and fails if it comes back.
 */

/**
 * Clockwise rotation to apply to a frame buffer so the scene comes out upright.
 *
 * `frame.orientation` reports how far the buffer is rotated relative to the
 * desired output ('landscape-left' = 90°), so we rotate back by the complement.
 * This matters more than it looks: the detector is not rotation invariant, and
 * feeding it a sideways buffer means asking it to recognise people lying down.
 *
 * If detection ends up worse than face detection on a device (ML Kit rotates
 * natively, so faces are unaffected), this table is the first thing to suspect —
 * swap '90deg' and '270deg'.
 */
export function uprightRotation(orientation: Orientation): Rotation {
  'worklet';
  switch (orientation) {
    case 'portrait': return '0deg';
    case 'landscape-left': return '270deg';
    case 'portrait-upside-down': return '180deg';
    case 'landscape-right': return '90deg';
    default: return '0deg';
  }
}

/** True when uprighting the frame swaps its width and height. */
export function swapsAxes(orientation: Orientation): boolean {
  'worklet';
  return orientation === 'landscape-left' || orientation === 'landscape-right';
}

/** Aspect ratio (w/h) of the frame once uprighted. */
export function uprightAspect(frameWidth: number, frameHeight: number, orientation: Orientation): number {
  'worklet';
  if (frameWidth <= 0 || frameHeight <= 0) return 1;
  return swapsAxes(orientation) ? frameHeight / frameWidth : frameWidth / frameHeight;
}
