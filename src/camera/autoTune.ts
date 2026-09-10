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
import { oneNotchDown, SENSITIVITY_PROFILES } from '../ml/sensitivity';
import { DeviceLoad, throttled, UNKNOWN_DEVICE_LOAD } from './deviceLoad';
import { t, tValue } from '../i18n';
import { formatFrameRate } from './frameRate';

/** What can be given up, cheapest loss first. Order is the whole policy. */
export type AutoTuneStep = 'autoZoom' | 'sensitivity' | 'precise';

/**
 * The auto-zoom frames a subject and finds none, so it goes first. Then a
 * notch of "Sensibilité", which costs looks per second but keeps every look as
 * good as it was. The larger detector is last: it is the only step that
 * decides whether a distant subject exists at all.
 */
export const AUTO_TUNE_LADDER: readonly AutoTuneStep[] = ['autoZoom', 'sensitivity', 'precise'];

/** Below this fraction of the target cadence, the device is not keeping up. */
export const SHORTFALL_RATIO = 0.7;
/** At or above this fraction, it has room to spare. Well clear of the other. */
export const HEADROOM_RATIO = 0.95;
/** Windows of shortfall before something is given up (~6 s). */
export const WINDOWS_TO_GIVE_UP = 3;
/**
 * Windows of shortfall on a device the platform reports as overheating.
 *
 * Shorter because the reading is a second, independent witness: waiting out the
 * usual evidence there means six more seconds of a phone that is being clocked
 * down while it is supposed to be watching a door.
 */
export const WINDOWS_TO_GIVE_UP_HOT = 1;
/** Windows of headroom before something is taken back (~30 s). */
export const WINDOWS_TO_RESTORE = 15;
/** Windows spent judging the step just taken. */
export const WINDOWS_TO_VERIFY = 3;
/**
 * Gain in the *fraction of the target being met* that counts as the step
 * having worked.
 *
 * A fraction and not a frame rate, because one of the steps lowers the target
 * itself: a phone stuck at 2,5 i/s against 5 is failing, and the same 2,5
 * against 3 is nearly keeping up. Judged in frames per second, dropping a
 * notch of "Sensibilité" would look like it changed nothing and be handed
 * straight back.
 */
export const MIN_GAIN = 0.1;

export interface AutoTuneMeasure {
  /** Cadence measured over the last window, from `countFrame`. */
  measured: number;
  /** Cadence "Sensibilité" asked for. */
  target: number;
  /**
   * What the platform says about heat and power during that window, where it
   * says anything. Most of the fleet reports nothing, so every use of it is a
   * refinement of a decision the cadence alone already reaches.
   */
  load?: DeviceLoad;
}

export interface AutoTuneState {
  /** Given up, in the order it was given up. Empty means the settings are untouched. */
  applied: readonly AutoTuneStep[];
  /** Tried, measured, and found to change nothing. Not tried again this session. */
  blocked: readonly AutoTuneStep[];
  /** Windows of evidence: positive to give something up, negative to take it back. */
  streak: number;
  /** Fraction of the target met just before the last step, and the windows left to judge it. */
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
  switch (step) {
    case 'autoZoom':
      return settings.autoZoom;
    // Nothing below "Basse" to step down to.
    case 'sensitivity':
      return oneNotchDown(settings.sens) !== settings.sens;
    case 'precise':
      return settings.preciseDetection;
  }
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
    // One notch, never two: a second one would have to be a second step, with
    // its own evidence and its own verification.
    sens: state.applied.includes('sensitivity') ? oneNotchDown(settings.sens) : settings.sens,
    preciseDetection: settings.preciseDetection && !state.applied.includes('precise'),
  };
}

/**
 * The cadence the camera is being asked for in this state — which the tuner
 * itself can lower.
 *
 * Without this, its own step down would look exactly like the user moving
 * "Sensibilité" under it, and it would abandon the verification of the step it
 * had just taken.
 */
export function expectedTarget(settings: Settings, state: AutoTuneState): number {
  return SENSITIVITY_PROFILES[tunedSettings(settings, state).sens].fps;
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
  // Switched off, everything it had taken goes back on the spot. Waiting out a
  // recovery would leave a capability off because of a device reading the user
  // has just said they do not want acted on.
  if (!settings.autoTune) {
    return state === IDLE_AUTO_TUNE ? state : IDLE_AUTO_TUNE;
  }

  const { measured, target, load = UNKNOWN_DEVICE_LOAD } = measure;
  if (!Number.isFinite(measured) || !Number.isFinite(target) || target <= 0 || measured < 0) {
    return state;
  }

  // A step is judged against the fraction of the target it was taken at, so a
  // window measured against a target the *user* moved says nothing about it.
  // The tuner's own step down the sensitivity ladder is not that case, which is
  // what `expectedTarget` is here to tell apart.
  if (state.decided && target !== expectedTarget(settings, state)) {
    return { ...state, streak: 0, before: null, verify: 0 };
  }

  const ratio = measured / target;

  if (state.verify > 0) {
    const verify = state.verify - 1;
    if (verify > 0) return { ...state, verify };
    const helped = state.before == null || ratio >= state.before + MIN_GAIN;
    if (helped) return { ...state, verify: 0, before: null, streak: 0 };

    // It did not help, so it goes back. Whether it is *blocked* depends on why
    // it did not: on a throttled device the step was never given a fair test —
    // the phone is slower than itself, and blacklisting it would cost that
    // capability for the rest of the session over a verdict the heat wrote.
    const undone = state.applied[state.applied.length - 1];
    return {
      applied: state.applied.slice(0, -1),
      blocked: throttled(load) ? state.blocked : [...state.blocked, undone],
      streak: 0,
      before: null,
      verify: 0,
      decided: { measured, target },
    };
  }

  if (ratio < SHORTFALL_RATIO) {
    const streak = Math.max(state.streak, 0) + 1;
    const step = nextStep(state, settings);
    const needed = load.thermal === 'hot' ? WINDOWS_TO_GIVE_UP_HOT : WINDOWS_TO_GIVE_UP;
    if (streak < needed || step == null) return { ...state, streak };
    return {
      applied: [...state.applied, step],
      blocked: state.blocked,
      streak: 0,
      before: ratio,
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

/**
 * The state a session starts in, from what the last one on this recording
 * quality had ended up giving up.
 *
 * A starting point, never a verdict: the steps come back with no verification
 * pending, so the loop hands each of them back after a sustained stretch of
 * full cadence exactly as if it had taken them itself. Anything the file does
 * not name, the ladder does not know, or the user has since switched off is
 * dropped — a stored step for a setting that is already off would be an
 * application taking credit for a removal it did not make.
 */
export function seedFrom(
  stored: Record<string, string[]> | null,
  quality: string,
  settings: Settings,
): AutoTuneState {
  if (!settings.autoTune || !stored) return IDLE_AUTO_TUNE;
  const raw = stored[quality];
  if (!Array.isArray(raw)) return IDLE_AUTO_TUNE;
  const applied = AUTO_TUNE_LADDER.filter(
    step => raw.includes(step) && removable(step, settings),
  );
  return applied.length > 0 ? { ...IDLE_AUTO_TUNE, applied, decided: null } : IDLE_AUTO_TUNE;
}

/** The file to write back, with this quality's entry replaced. */
export function seedsWith(
  stored: Record<string, string[]> | null,
  quality: string,
  applied: readonly AutoTuneStep[],
): Record<string, string[]> {
  const next = { ...(stored ?? {}) };
  if (applied.length > 0) next[quality] = [...applied];
  // An empty entry is removed rather than stored: "nothing was given up" is
  // what no entry already means, and keeping one would grow the file with a
  // row per quality the phone has ever recorded at.
  else delete next[quality];
  return next;
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
export function describeAutoTune(state: AutoTuneState, load: DeviceLoad = UNKNOWN_DEVICE_LOAD): string {
  // Said first when it applies: "the device analyses 1,4 i/s instead of 5" is
  // the symptom, and the heat is the reason — including the reason it will end.
  if (state.applied.length > 0 && throttled(load)) return t('autoTune.throttled');
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
