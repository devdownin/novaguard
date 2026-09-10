import { useWindowDimensions } from 'react-native';

/**
 * True when the phone is held horizontally.
 *
 * `useWindowDimensions` rather than a `Dimensions.get` read: the activity
 * declares `orientation|screenSize` in its `configChanges`, so a rotation
 * never remounts anything — a value read once at mount would keep reporting
 * the orientation the app happened to launch in, forever.
 *
 * The comparison is between the two sides, not against a breakpoint: what
 * decides these layouts is which axis is short, not how large the screen is.
 * A square-ish window counts as portrait, which is the safer of the two —
 * portrait is the layout that survives being given too much width.
 */
export function useLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height;
}
