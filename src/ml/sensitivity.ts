import { Sensitivity } from '../state/types';
import { DEFAULT_TRACKER_OPTIONS, TrackerOptions } from './tracker';

/**
 * What "Sensibilité" actually sets.
 *
 * It used to set one thing — how often the scene is looked at — and that made
 * the two ends of the scale mean something other than what they say. At
 * "Basse", one look per second with `confirmAfter: 2` means a subject has to be
 * there for a whole second before anything is recorded: the beginning of every
 * passage was lost, every time. At "Haute" the extra looks bought nothing but
 * battery, since what was accepted from each of them never changed.
 *
 * So the setting moves all three together, and they trade against each other.
 * Corroborating a detection on the next look is cheap at 5 fps (200 ms) and
 * expensive at 1 fps (a second of the passage). At "Basse" that corroboration is
 * given up — and paid for with a higher score, because "seen once, clearly" and
 * "seen twice" are the two ways to not record noise, and dropping both at once
 * would turn one bad frame into a recording. At "Haute" the looks are frequent
 * enough that a weaker one can be accepted: two of them still have to agree.
 *
 * Kept in one place rather than spread over `CameraFeed` and `reportDetections`
 * so the exchange can be exercised as the single decision it is — a test that
 * recomputed it would go on passing after the real one changed.
 */
export interface SensitivityProfile {
  /** Frames per second handed to the model. */
  fps: number;
  /** Consecutive hits before a track is trusted. */
  confirmAfter: number;
  /**
   * Added to the user's threshold before it becomes `startConfidence`, as a
   * fraction. Positive where a track is confirmed on fewer looks.
   */
  startConfidenceBonus: number;
}

/**
 * Lowest first. The order is what "one notch down" means, and the self-tuning
 * ladder steps through it rather than capping frames per second on its own:
 * the three values move together (see above), so a cadence lowered by itself
 * would keep asking for corroboration it can no longer afford.
 */
export const SENSITIVITY_ORDER: readonly Sensitivity[] = ['Basse', 'Moyenne', 'Haute'];

/** The next sensitivity down, or the same one at the bottom of the scale. */
export function oneNotchDown(sens: Sensitivity): Sensitivity {
  const index = SENSITIVITY_ORDER.indexOf(sens);
  return index > 0 ? SENSITIVITY_ORDER[index - 1] : sens;
}

export const SENSITIVITY_PROFILES: Record<Sensitivity, SensitivityProfile> = {
  Basse: { fps: 1, confirmAfter: 1, startConfidenceBonus: 0.1 },
  Moyenne: { fps: 3, confirmAfter: 2, startConfidenceBonus: 0 },
  Haute: { fps: 5, confirmAfter: 2, startConfidenceBonus: -0.05 },
};

/**
 * The tracker's settings for one sensitivity and one threshold percentage.
 *
 * The bonus is clamped rather than allowed to leave 0–1: at "Basse" the top of
 * the slider (95 %) would otherwise ask for 1.05, which no detection can reach,
 * and the sensitivity setting would silently switch detection off entirely.
 */
export function trackerOptionsFor(sens: Sensitivity, threshold: number): TrackerOptions {
  const profile = SENSITIVITY_PROFILES[sens];
  const startConfidence = threshold / 100 + profile.startConfidenceBonus;
  return {
    ...DEFAULT_TRACKER_OPTIONS,
    confirmAfter: profile.confirmAfter,
    startConfidence: Math.min(Math.max(startConfidence, 0), 1),
  };
}
