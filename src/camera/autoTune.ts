/**
 * What the app gives up, on its own, when the phone cannot keep up.
 *
 * `frameRate.ts` measures the cadence actually achieved against the one
 * "Sensibilité" asked for, and that measurement was only ever displayed. A
 * device that falls behind analyses fewer frames and says nothing else about
 * it: the passage crossing the garden between two looks is simply never seen,
 * and nothing in the app reacts. This is the reaction.
 *
 * Three rules shape it, and none of them is optional:
 *
 * - **It only ever takes away, never grants.** Every step removes something the
 *   user asked for and can be given back; nothing here switches on what they
 *   left off. A surveillance camera that quietly enables what its owner
 *   declined is worse than a slow one.
 * - **Detection quality is the last thing surrendered.** The ladder starts with
 *   the auto-zoom, which frames a subject nicely and finds none, and only then
 *   touches the larger detector — the one thing on the list that decides
 *   whether a distant subject exists at all.
 * - **A step that changed nothing is taken back.** Thermal throttling, a busy
 *   phone or a 4K format cost frames that no setting here can buy back; without
 *   the check, the app would keep stripping capability against a wall. The rate
 *   measured before the step is kept precisely so the step can be judged.
 *
 * Hysteresis is deliberately asymmetric: giving something up takes three
 * windows of clear shortfall (about six seconds), taking it back takes fifteen
 * windows at nearly full cadence (about thirty). Restoring costs a rebuilt
 * frame processor and, for the detector, a model load — flapping between the
 * two would cost more frames than either state.
 */

import { Settings } from '../state/types';
import { t, tValue } from '../i18n';
import { formatFrameRate } from './frameRate';

/** What can be given up, cheapest loss first. Order is the whole policy. */
export type AutoTuneStep = 'autoZoom' | 'precise';

export const AUTO_TUNE_LADDER: readonly AutoTuneStep[] = ['autoZoom', 'precise'];

/** Below this fraction of the target cadence, the device is not keeping up. */
export const SHORTFALL_RATIO = 0.7;
/** At or above this fraction, it has room to spare. Well clear of the other. */
export const HEADROOM_RATIO = 0.95;
/** Windows of shortfall before something is given up (~6 s). */
export const WINDOWS_TO_GIVE_UP = 3;
/** Windows of headroom before something is taken back (~30 s). */
export const WINDOWS_TO_RESTORE = 15;
/** Windows spent judging the step just taken. */
export const WINDOWS_TO_VERIFY = 3;
/** Relative gain in measured cadence that counts as the step having worked. */
export const MIN_GAIN = 0.1;

export interface AutoTuneMeasure {
  /** Cadence measured over the last window, from `countFrame`. */
  measured: number;
  /** Cadence "Sensibilité" asked for. */
  target: number;
}

export interface AutoTuneState {
  /** Given up, in the order it was given up. Empty means the settings are untouched. */
  applied: readonly AutoTuneStep[];
  /** Tried, measured, and found to change nothing. Not tried again this session. */
  blocked: readonly AutoTuneStep[];
  /** Windows of evidence: positive to give something up, negative to take it back. */
  streak: number;
  /** Cadence measured just before the last step, and the windows left to judge it. */
  before: number | null;
  verify: number;
  /**
   * The measurement that justified the current state — what Setup reports.
   * A new object only on a decision, so a bare identity check tells the
   * provider whether anything worth re-rendering happened.
   */
  decided: AutoTuneMeasure | null;
}

export const IDLE_AUTO_TUNE: AutoTuneState = {
  applied: [], blocked: [], streak: 0, before: null, verify: 0, decided: null,
};

/** Whether a step still has anything to remove, given what the user asked for. */
function removable(step: AutoTuneStep, settings: Settings): boolean {
  return step === 'autoZoom' ? settings.autoZoom : settings.preciseDetection;
}

/**
 * The next step worth taking, or null when there is nothing left to give up.
 *
 * A step the user has already turned off is skipped rather than counted:
 * "applied" it would change no cost, and the verification that follows would
 * then blame the ladder for a device that was never going to catch up.
 */
export function nextStep(state: AutoTuneState, settings: Settings): AutoTuneStep | null {
  for (const step of AUTO_TUNE_LADDER) {
    if (state.applied.includes(step)) continue;
    if (state.blocked.includes(step)) continue;
    if (!removable(step, settings)) continue;
    return step;
  }
  return null;
}

/** The settings the camera should actually run with. Only ever removes. */
export function tunedSettings(settings: Settings, state: AutoTuneState): Settings {
  if (state.applied.length === 0) return settings;
  return {
    ...settings,
    autoZoom: settings.autoZoom && !state.applied.includes('autoZoom'),
    preciseDetection: settings.preciseDetection && !state.applied.includes('precise'),
  };
}

/**
 * True when the two states differ in anything a reader would see.
 *
 * The streak and the verification countdown move on every closed window; the
 * provider that owns this state re-renders the whole app when it publishes,
 * so it publishes on decisions only.
 */
export function decisionChanged(a: AutoTuneState, b: AutoTuneState): boolean {
  return a.applied !== b.applied || a.decided !== b.decided;
}

/**
 * Folds one closed frame-rate window in.
 *
 * Returns the same state object when nothing moved, so callers can compare by
 * identity. A non-finite or zero target is ignored rather than divided by: it
 * means no sensitivity profile was in play for that window.
 */
export function updateAutoTune(
  state: AutoTuneState,
  measure: AutoTuneMeasure,
  settings: Settings,
): AutoTuneState {
  const { measured, target } = measure;
  if (!Number.isFinite(measured) || !Number.isFinite(target) || target <= 0 || measured < 0) {
    return state;
  }

  // A step is judged against the rate that justified it, so a window measured
  // under a different target says nothing about it: the verification is
  // abandoned rather than answered with the wrong yardstick, and the step is
  // kept — it was taken on evidence, and there is none against it.
  if (state.decided && state.decided.target !== target) {
    return { ...state, streak: 0, before: null, verify: 0 };
  }

  if (state.verify > 0) {
    const verify = state.verify - 1;
    if (verify > 0) return { ...state, verify };
    const helped = state.before == null || measured >= state.before * (1 + MIN_GAIN);
    if (helped) return { ...state, verify: 0, before: null, streak: 0 };

    // It did not help. Give it back, and stop trying it: what is holding this
    // device back is not on the ladder.
    const undone = state.applied[state.applied.length - 1];
    const applied = state.applied.slice(0, -1);
    return {
      applied,
      blocked: [...state.blocked, undone],
      streak: 0,
      before: null,
      verify: 0,
      decided: { measured, target },
    };
  }

  const ratio = measured / target;

  if (ratio < SHORTFALL_RATIO) {
    const streak = Math.max(state.streak, 0) + 1;
    const step = nextStep(state, settings);
    if (streak < WINDOWS_TO_GIVE_UP || step == null) return { ...state, streak };
    return {
      applied: [...state.applied, step],
      blocked: state.blocked,
      streak: 0,
      before: measured,
      verify: WINDOWS_TO_VERIFY,
      decided: { measured, target },
    };
  }

  if (ratio >= HEADROOM_RATIO && state.applied.length > 0) {
    const streak = Math.min(state.streak, 0) - 1;
    if (-streak < WINDOWS_TO_RESTORE) return { ...state, streak };
    return {
      applied: state.applied.slice(0, -1),
      blocked: state.blocked,
      streak: 0,
      before: null,
      verify: 0,
      decided: { measured, target },
    };
  }

  // Between the two thresholds: no evidence either way, and evidence gathered
  // for a direction the scene has left is not evidence any more.
  return state.streak === 0 ? state : { ...state, streak: 0 };
}

/** The headline: what is currently given up, or that nothing is. */
export function formatAutoTune(state: AutoTuneState): string {
  if (state.applied.length === 0) return t('autoTune.none');
  return state.applied.map(step => tValue(`value.autoTune.${step}`)).join(' · ');
}

/**
 * The detail under it: the measurement behind the current state, named as a
 * measurement. Without it the row says what was taken away and never why.
 */
export function describeAutoTune(state: AutoTuneState): string {
  if (!state.decided) return t('autoTune.watching');
  const rates = {
    measured: formatFrameRate(state.decided.measured),
    target: formatFrameRate(state.decided.target),
  };
  if (state.applied.length === 0) {
    return state.blocked.length > 0 ? t('autoTune.noGain', rates) : t('autoTune.restored', rates);
  }
  return t('autoTune.shortfall', rates);
}
