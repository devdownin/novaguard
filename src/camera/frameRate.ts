/**
 * The cadence the camera actually achieves, as opposed to the one asked for.
 *
 * "Sensibilité" sets a target — 1, 3 or 5 frames per second — and nothing
 * guaranteed it was met. `runAtTargetFps` stamps its clock *before* running the
 * work, and `runAsync` drops a frame outright when the previous one is still
 * being analysed, so a device that cannot keep up simply analyses less often
 * and says nothing. At 4K, where every analysed frame means downscaling 8.3 MP
 * to 320×320, the gap is wide enough to matter to whether a passing subject is
 * seen at all.
 */

/**
 * Averaging window. Long enough that one slow frame does not make the figure
 * jump, short enough to answer "is the phone keeping up?" while you watch.
 */
export const FRAME_RATE_WINDOW_MS = 2000;

/** French-formatted frames per second, e.g. `2,9 i/s`. */
export function formatFrameRate(framesPerSecond: number): string {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) return '—';
  return `${framesPerSecond.toFixed(1).replace('.', ',')} i/s`;
}

/** Running count for one averaging window. */
export interface FrameRateWindow {
  count: number;
  /**
   * Epoch ms the window opened, or null before the first frame of a session.
   * Null rather than 0, which is a timestamp like any other and made the window
   * re-open on every frame the moment anything fed it one.
   */
  since: number | null;
}

export const EMPTY_FRAME_RATE_WINDOW: FrameRateWindow = { count: 0, since: null };

/**
 * Folds one frame into the window, returning a rate only when a full window has
 * elapsed. Mutates by design: this runs on the frame path, and allocating a
 * window object per frame is exactly the kind of cost this file measures.
 *
 * The first frame of a session only opens the window: there is no elapsed time
 * to divide by yet.
 */
export function countFrame(window: FrameRateWindow, now: number): number | null {
  if (window.since == null) {
    window.since = now;
    window.count = 0;
    return null;
  }
  window.count++;
  const elapsed = now - window.since;
  if (elapsed < FRAME_RATE_WINDOW_MS) return null;

  const rate = (window.count * 1000) / elapsed;
  window.since = now;
  window.count = 0;
  return rate;
}
