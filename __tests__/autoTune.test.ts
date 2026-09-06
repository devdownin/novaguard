/**
 * What the app gives up on its own, and — the half that matters — what it
 * refuses to give up.
 *
 * The measured cadence was displayed and nothing more: a phone analysing 1
 * frame per second where "Sensibilité" asked for 5 said so in a corner of the
 * viewfinder and carried on missing passages. Acting on that measurement is
 * only safe with the three rules this suite holds: nothing is ever switched on
 * that the user left off, detection quality is the last thing surrendered, and
 * a step that bought no frames is taken back rather than kept.
 *
 * @format
 */

import {
  AutoTuneState, describeAutoTune, decisionChanged, formatAutoTune, IDLE_AUTO_TUNE, nextStep,
  tunedSettings, updateAutoTune, WINDOWS_TO_GIVE_UP, WINDOWS_TO_RESTORE, WINDOWS_TO_VERIFY,
} from '../src/camera/autoTune';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

const TARGET = 3;
/** Well under `SHORTFALL_RATIO` of the target, as a struggling phone reads. */
const BEHIND = 0.6;

const withSettings = (over: Partial<Settings>): Settings => ({ ...defaultSettings, ...over });

/** Both levers on, which is what makes the ladder's order observable. */
const everything = withSettings({ autoZoom: true, preciseDetection: true });

function run(
  state: AutoTuneState,
  rates: number[],
  settings: Settings = everything,
  target = TARGET,
): AutoTuneState {
  return rates.reduce((s, measured) => updateAutoTune(s, { measured, target }, settings), state);
}

const behindFor = (windows: number) => new Array(windows).fill(BEHIND);

/** A state with one step already given up and its verification passed. */
function afterFirstStep(settings: Settings = everything): AutoTuneState {
  const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP), settings);
  return run(given, new Array(WINDOWS_TO_VERIFY).fill(TARGET), settings);
}

describe('while the device keeps up', () => {
  it('gives nothing up, and does not even allocate', () => {
    const state = run(IDLE_AUTO_TUNE, [TARGET, TARGET, TARGET, TARGET]);

    expect(state).toBe(IDLE_AUTO_TUNE);
  });

  it('ignores a window it cannot read', () => {
    // A target of 0 means no profile was in play; NaN comes from a clock jump.
    expect(updateAutoTune(IDLE_AUTO_TUNE, { measured: 2, target: 0 }, everything))
      .toBe(IDLE_AUTO_TUNE);
    expect(updateAutoTune(IDLE_AUTO_TUNE, { measured: NaN, target: TARGET }, everything))
      .toBe(IDLE_AUTO_TUNE);
  });

  it('forgets evidence when the shortfall stops', () => {
    const wobbling = run(IDLE_AUTO_TUNE, [...behindFor(WINDOWS_TO_GIVE_UP - 1), TARGET * 0.8]);

    // 0.8 of the target is neither a shortfall nor headroom: the windows that
    // came before it are not evidence about a scene that has changed.
    expect(wobbling.streak).toBe(0);
    expect(run(wobbling, behindFor(WINDOWS_TO_GIVE_UP - 1)).applied).toEqual([]);
  });
});

describe('when the device falls behind', () => {
  it('waits for a sustained shortfall, not one slow window', () => {
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP - 1)).applied).toEqual([]);
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP)).applied).toEqual(['autoZoom']);
  });

  it('gives up the auto-zoom before the detector', () => {
    // The auto-zoom frames a subject; it never finds one. The larger detector
    // decides whether a distant subject exists at all, so it goes last.
    const first = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const verified = run(first, new Array(WINDOWS_TO_VERIFY).fill(BEHIND * 2));
    const second = run(verified, behindFor(WINDOWS_TO_GIVE_UP));

    expect(first.applied).toEqual(['autoZoom']);
    expect(second.applied).toEqual(['autoZoom', 'precise']);
  });

  it('skips a step the user already turned off', () => {
    const noZoom = withSettings({ autoZoom: false, preciseDetection: true });

    // Applying it would remove no cost, and the verification that follows
    // would then blame the ladder for a device that was never going to catch up.
    expect(nextStep(IDLE_AUTO_TUNE, noZoom)).toBe('precise');
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP), noZoom).applied).toEqual(['precise']);
  });

  it('stops when there is nothing of its own left to give up', () => {
    const bare = withSettings({ autoZoom: false, preciseDetection: false });
    const state = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP * 4), bare);

    expect(nextStep(IDLE_AUTO_TUNE, bare)).toBeNull();
    expect(state.applied).toEqual([]);
    expect(state.decided).toBeNull();
  });
});

describe('judging the step it just took', () => {
  it('keeps a step that bought frames', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const judged = run(given, new Array(WINDOWS_TO_VERIFY).fill(BEHIND * 2));

    expect(judged.applied).toEqual(['autoZoom']);
    expect(judged.blocked).toEqual([]);
  });

  it('takes back a step that changed nothing, and never tries it again', () => {
    // Thermal throttling, a busy phone, a 4K format: none of it is on the
    // ladder, and stripping capability against a wall helps nobody.
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const judged = run(given, new Array(WINDOWS_TO_VERIFY).fill(BEHIND));

    expect(judged.applied).toEqual([]);
    expect(judged.blocked).toEqual(['autoZoom']);
    // The shortfall is still there, so it moves on down the ladder instead.
    expect(run(judged, behindFor(WINDOWS_TO_GIVE_UP)).applied).toEqual(['precise']);
  });

  it('abandons the verdict when the target moves under it', () => {
    // The rate was measured against 3 i/s; at 1 i/s the same figure means
    // something else entirely, and answering with the wrong yardstick would
    // take back a step that was working.
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const rescaled = updateAutoTune(given, { measured: BEHIND, target: 1 }, everything);

    expect(rescaled.applied).toEqual(['autoZoom']);
    expect(rescaled.verify).toBe(0);
  });
});

describe('giving it back', () => {
  it('takes far longer than giving it up', () => {
    const state = afterFirstStep();

    // Restoring rebuilds the frame processor and, for the detector, reloads a
    // model: flapping would cost more frames than either state.
    expect(run(state, new Array(WINDOWS_TO_RESTORE - 1).fill(TARGET)).applied).toEqual(['autoZoom']);
    expect(run(state, new Array(WINDOWS_TO_RESTORE).fill(TARGET)).applied).toEqual([]);
  });

  it('needs the headroom to be real, not merely adequate', () => {
    const state = afterFirstStep();

    // 0.8 of the target is the band between the two thresholds: not a
    // shortfall, and not enough to hand back what was taken.
    expect(run(state, new Array(WINDOWS_TO_RESTORE * 2).fill(TARGET * 0.8)).applied)
      .toEqual(['autoZoom']);
  });
});

describe('tunedSettings', () => {
  it('never grants what the user declined', () => {
    const declined = withSettings({ autoZoom: false, preciseDetection: false });
    const state: AutoTuneState = { ...IDLE_AUTO_TUNE, applied: ['autoZoom', 'precise'] };

    const tuned = tunedSettings(declined, state);

    expect(tuned.autoZoom).toBe(false);
    expect(tuned.preciseDetection).toBe(false);
  });

  it('removes exactly what was given up, and nothing else', () => {
    const state: AutoTuneState = { ...IDLE_AUTO_TUNE, applied: ['autoZoom'] };

    const tuned = tunedSettings(everything, state);

    expect(tuned.autoZoom).toBe(false);
    expect(tuned.preciseDetection).toBe(true);
    expect({ ...tuned, autoZoom: true }).toEqual(everything);
  });

  it('hands back the same object while nothing is given up', () => {
    // A new object here would re-run every memo the camera hangs off it.
    expect(tunedSettings(everything, IDLE_AUTO_TUNE)).toBe(everything);
  });
});

describe('what the provider publishes', () => {
  it('holds its peace while only the evidence moves', () => {
    const gathering = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP - 1));

    // Publishing re-renders the whole app; a streak is not news.
    expect(gathering).not.toBe(IDLE_AUTO_TUNE);
    expect(decisionChanged(IDLE_AUTO_TUNE, gathering)).toBe(false);
  });

  it('reports a decision', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));

    expect(decisionChanged(IDLE_AUTO_TUNE, given)).toBe(true);
  });
});

describe('what Setup reads', () => {
  it('says nothing was taken before anything was measured', () => {
    expect(formatAutoTune(IDLE_AUTO_TUNE)).toBe('Rien retiré');
    expect(describeAutoTune(IDLE_AUTO_TUNE)).toContain('Lancez la surveillance');
  });

  it('names what was taken and the measurement behind it', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));

    expect(formatAutoTune(given)).toBe('Zoom auto');
    // A capability that disappears without saying why reads as a bug.
    expect(describeAutoTune(given)).toContain('0,6 i/s');
    expect(describeAutoTune(given)).toContain('3,0 i/s');
  });

  it('distinguishes a step given back from one never taken', () => {
    const undone = run(
      run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP)),
      new Array(WINDOWS_TO_VERIFY).fill(BEHIND),
    );

    expect(formatAutoTune(undone)).toBe('Rien retiré');
    expect(describeAutoTune(undone)).toContain('n’y changeait rien');
  });
});
