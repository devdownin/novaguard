import { MIN_MEAN } from '../ml/lowLight';

/**
 * Noticing that the camera has stopped seeing the room.
 *
 * A covered lens and a phone knocked over both look, to the detector, like an
 * empty room — which is exactly what the app reports when nothing happens. Two
 * signals separate them, both read from the scene sample the analysis already
 * takes (`sceneSample`):
 *
 * - **obstructed**: the frame stays black (mean luma under `MIN_MEAN`, where
 *   nothing is even attempted) for `OBSTRUCTED_AFTER_MS`. A room with the
 *   lights off is the same blind spot, and is named as one.
 * - **moved**: with nobody tracked, the 8×8 luma layout stops correlating with
 *   the reference for `MOVED_AFTER_MS`. Correlation, not difference, so that a
 *   cloud or dusk changing the overall level does not count; the reference
 *   drifts slowly with the scene for the same reason. Latched until the user
 *   acknowledges it or monitoring restarts: a phone that was turned is still
 *   turned after the alert.
 */
export const OBSTRUCTED_AFTER_MS = 5_000;
export const MOVED_AFTER_MS = 8_000;
export const MOVED_BELOW = 0.5;
const REFERENCE_DRIFT = 0.02;

export interface TamperWatch {
  reference: number[] | null;
  darkSince: number | null;
  changedSince: number | null;
  obstructed: boolean;
  /** When the field of view was found changed; null when it is not. */
  movedAt: number | null;
}

export const IDLE_WATCH: TamperWatch = { reference: null, darkSince: null, changedSince: null, obstructed: false, movedAt: null };

/** Pearson correlation of two layouts; two flat layouts are the same scene. */
export function sceneSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let ma = 0; let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma; const db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  const flat = 1e-6 * n;
  if (va < flat && vb < flat) return 1;
  if (va < flat || vb < flat) return 0;
  return cov / Math.sqrt(va * vb);
}

/** The watch after one analysed frame. `subjects` is whether anyone is tracked. */
export function watchScene(watch: TamperWatch, sample: readonly number[], subjects: boolean, now: number): TamperWatch {
  if (sample.length < 2) return watch;
  const luma = sample[0];
  if (luma < MIN_MEAN) {
    const darkSince = watch.darkSince ?? now;
    const obstructed = now - darkSince >= OBSTRUCTED_AFTER_MS;
    return obstructed === watch.obstructed && darkSince === watch.darkSince ? watch : { ...watch, darkSince, obstructed };
  }
  const grid = sample.slice(1);
  let next: TamperWatch = watch.darkSince == null && !watch.obstructed ? watch : { ...watch, darkSince: null, obstructed: false };
  if (next.reference == null) return subjects ? next : { ...next, reference: grid };
  // Somebody in shot changes the layout by being there; that is a visitor, not a move.
  if (subjects) return next.changedSince == null ? next : { ...next, changedSince: null };
  if (sceneSimilarity(grid, next.reference) < MOVED_BELOW) {
    const changedSince = next.changedSince ?? now;
    if (now - changedSince < MOVED_AFTER_MS) return changedSince === next.changedSince ? next : { ...next, changedSince };
    // The new view becomes the reference, so the alert fires once per move.
    return { ...next, reference: grid, changedSince: null, movedAt: next.movedAt ?? now };
  }
  const reference = next.reference.map((v, i) => v + (grid[i] - v) * REFERENCE_DRIFT);
  return { ...next, reference, changedSince: null };
}

/** The user has seen the alert: the current view is the one to watch. */
export function acknowledgeMove(watch: TamperWatch): TamperWatch {
  return watch.movedAt == null ? watch : { ...watch, movedAt: null };
}
