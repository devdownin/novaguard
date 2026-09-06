/**
 * What the app gives up on its own, and — the half that matters — what it
 * refuses to give up.
 *
 * The measured cadence was displayed and nothing more: a phone analysing 1
 * frame per second where "Sensibilité" asked for 5 said so in a corner of the
 * viewfinder and carried on missing passages. Acting on that measurement is
 * only safe with the rules this suite holds: nothing is ever switched on that
 * the user left off, detection quality is the last thing surrendered, a step
 * that bought no frames is taken back rather than kept, and the whole thing
 * stops the moment the user switches it off.
 *
 * Windows are fed as a *fraction of the target*, because one of the steps
 * lowers the target itself — the harness recomputes what the camera is being
 * asked for after every decision, exactly as the provider does.
 *
 * @format
 */

import {
  AutoTuneState, describeAutoTune, decisionChanged, expectedTarget, formatAutoTune, IDLE_AUTO_TUNE,
  nextStep, seedFrom, seedsWith, tunedSettings, updateAutoTune, WINDOWS_TO_GIVE_UP,
  WINDOWS_TO_RESTORE, WINDOWS_TO_VERIFY,
} from '../src/camera/autoTune';
import { WINDOWS_TO_GIVE_UP_HOT } from '../src/camera/autoTune';
import { deviceLoadOf, DeviceLoad } from '../src/camera/deviceLoad';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

/** Well under `SHORTFALL_RATIO`, as a struggling phone reads. */
const BEHIND = 0.2;
/** Between the two thresholds: neither a shortfall nor headroom. */
const ADEQUATE = 0.8;
const KEEPING_UP = 1;

const withSettings = (over: Partial<Settings>): Settings => ({ ...defaultSettings, ...over });

/** Every step available, which is what makes the ladder's order observable. */
const everything = withSettings({ autoZoom: true, sens: 'Moyenne', preciseDetection: true });

/**
 * Folds a series of windows in, each measured against the cadence the camera
 * is actually being asked for in the state it has reached.
 */
function run(
  state: AutoTuneState,
  ratios: number[],
  settings: Settings = everything,
  load?: DeviceLoad,
): AutoTuneState {
  return ratios.reduce((current, ratio) => {
    const target = expectedTarget(settings, current);
    return updateAutoTune(current, { measured: ratio * target, target, load }, settings);
  }, state);
}

/** Android reporting CRITICAL, and a phone the platform says is fine. */
const HOT = deviceLoadOf(4, 40, false);
const COOL = deviceLoadOf(0, 40, false);

const behindFor = (windows: number) => new Array(windows).fill(BEHIND);

/**
 * Runs out the verification of the step just taken, with windows good enough
 * to keep it. Every ladder assertion needs it: only one change is ever in
 * flight, and the next step waits for this one to be judged.
 */
function judged(state: AutoTuneState, settings: Settings = everything): AutoTuneState {
  return run(state, new Array(WINDOWS_TO_VERIFY).fill(ADEQUATE), settings);
}

describe('while the device keeps up', () => {
  it('gives nothing up, and does not even allocate', () => {
    expect(run(IDLE_AUTO_TUNE, [KEEPING_UP, KEEPING_UP, KEEPING_UP])).toBe(IDLE_AUTO_TUNE);
  });

  it('ignores a window it cannot read', () => {
    // A target of 0 means no profile was in play; NaN comes from a clock jump.
    expect(updateAutoTune(IDLE_AUTO_TUNE, { measured: 2, target: 0 }, everything))
      .toBe(IDLE_AUTO_TUNE);
    expect(updateAutoTune(IDLE_AUTO_TUNE, { measured: NaN, target: 3 }, everything))
      .toBe(IDLE_AUTO_TUNE);
  });

  it('forgets evidence when the shortfall stops', () => {
    const wobbling = run(IDLE_AUTO_TUNE, [...behindFor(WINDOWS_TO_GIVE_UP - 1), ADEQUATE]);

    expect(wobbling.streak).toBe(0);
    expect(run(wobbling, behindFor(WINDOWS_TO_GIVE_UP - 1)).applied).toEqual([]);
  });
});

describe('when the device falls behind', () => {
  it('waits for a sustained shortfall, not one slow window', () => {
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP - 1)).applied).toEqual([]);
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP)).applied).toEqual(['autoZoom']);
  });

  it('walks the ladder in order, detector last', () => {
    // The auto-zoom frames a subject and never finds one, so it goes first. A
    // notch of "Sensibilité" costs looks per second but keeps each look as good
    // as it was. The detector decides whether a distant subject exists at all.
    const first = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const second = run(judged(first), behindFor(WINDOWS_TO_GIVE_UP));
    const third = run(judged(second), behindFor(WINDOWS_TO_GIVE_UP));

    expect(first.applied).toEqual(['autoZoom']);
    expect(second.applied).toEqual(['autoZoom', 'sensitivity']);
    expect(third.applied).toEqual(['autoZoom', 'sensitivity', 'precise']);
  });

  it('steps the sensitivity down one notch, never two', () => {
    const state = run(judged(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP))),
      behindFor(WINDOWS_TO_GIVE_UP));

    // A second notch would have to be a second step, with its own evidence and
    // its own verification.
    expect(tunedSettings(everything, state).sens).toBe('Basse');
    expect(expectedTarget(everything, state)).toBe(1);
  });

  it('skips a step the user already turned off', () => {
    const bottom = withSettings({ autoZoom: false, sens: 'Basse', preciseDetection: true });

    // Applying it would remove no cost, and the verification that follows would
    // then blame the ladder for a device that was never going to catch up.
    // "Basse" is the bottom of the scale: there is no notch below it.
    expect(nextStep(IDLE_AUTO_TUNE, bottom)).toBe('precise');
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP), bottom).applied).toEqual(['precise']);
  });

  it('stops when there is nothing of its own left to give up', () => {
    const bare = withSettings({ autoZoom: false, sens: 'Basse', preciseDetection: false });
    const state = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP * 4), bare);

    expect(nextStep(IDLE_AUTO_TUNE, bare)).toBeNull();
    expect(state.applied).toEqual([]);
    expect(state.decided).toBeNull();
  });
});

describe('judging the step it just took', () => {
  it('keeps a step that bought frames', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const verdict = run(given, new Array(WINDOWS_TO_VERIFY).fill(0.45));

    expect(verdict.applied).toEqual(['autoZoom']);
    expect(verdict.blocked).toEqual([]);
  });

  it('takes back a step that changed nothing, and never tries it again', () => {
    // Thermal throttling, a busy phone, a 4K format: none of it is on the
    // ladder, and stripping capability against a wall helps nobody.
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));
    const verdict = run(given, behindFor(WINDOWS_TO_VERIFY));

    expect(verdict.applied).toEqual([]);
    expect(verdict.blocked).toEqual(['autoZoom']);
    // The shortfall is still there, so it moves on down the ladder instead.
    expect(run(verdict, behindFor(WINDOWS_TO_GIVE_UP)).applied).toEqual(['sensitivity']);
  });

  it('judges by the fraction of the target met, not by frames per second', () => {
    // The sensitivity step lowers the target: 1 i/s against 1 is keeping up,
    // and reading the same window in frames per second would call the step a
    // failure and hand it straight back.
    const stepped = run(judged(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP))),
      behindFor(WINDOWS_TO_GIVE_UP));
    const verdict = run(stepped, new Array(WINDOWS_TO_VERIFY).fill(KEEPING_UP));

    expect(verdict.applied).toEqual(['autoZoom', 'sensitivity']);
    expect(verdict.blocked).toEqual([]);
  });

  it('abandons the verdict when the user moves the target under it', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));

    // "Sensibilité" pushed to Haute mid-verification: 5 i/s asked for where the
    // state expects 3. The step stays — it was taken on evidence — but the
    // window says nothing about it.
    const rescaled = updateAutoTune(given, { measured: 1, target: 5 }, everything);

    expect(rescaled.applied).toEqual(['autoZoom']);
    expect(rescaled.verify).toBe(0);
  });
});

describe('giving it back', () => {
  it('takes far longer than giving it up', () => {
    const state = judged(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP)));

    // Restoring rebuilds the frame processor and, for the detector, reloads a
    // model: flapping would cost more frames than either state.
    expect(run(state, new Array(WINDOWS_TO_RESTORE - 1).fill(KEEPING_UP)).applied)
      .toEqual(['autoZoom']);
    expect(run(state, new Array(WINDOWS_TO_RESTORE).fill(KEEPING_UP)).applied).toEqual([]);
  });

  it('needs the headroom to be real, not merely adequate', () => {
    const state = judged(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP)));

    expect(run(state, new Array(WINDOWS_TO_RESTORE * 2).fill(ADEQUATE)).applied)
      .toEqual(['autoZoom']);
  });
});

describe('switched off', () => {
  const off = withSettings({ autoTune: false, autoZoom: true, preciseDetection: true });

  it('never takes anything, however far behind the device is', () => {
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP * 4), off)).toBe(IDLE_AUTO_TUNE);
  });

  it('gives back what it had taken, on the spot', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));

    // Not after a recovery: waiting would leave a capability off because of a
    // device reading the user has just said they do not want acted on.
    expect(run(given, [BEHIND], off)).toBe(IDLE_AUTO_TUNE);
  });
});

describe('tunedSettings', () => {
  it('never grants what the user declined', () => {
    const declined = withSettings({ autoZoom: false, sens: 'Basse', preciseDetection: false });
    const state: AutoTuneState = {
      ...IDLE_AUTO_TUNE, applied: ['autoZoom', 'sensitivity', 'precise'],
    };

    const tuned = tunedSettings(declined, state);

    expect(tuned.autoZoom).toBe(false);
    expect(tuned.preciseDetection).toBe(false);
    expect(tuned.sens).toBe('Basse');
  });

  it('removes exactly what was given up, and nothing else', () => {
    const state: AutoTuneState = { ...IDLE_AUTO_TUNE, applied: ['autoZoom'] };

    const tuned = tunedSettings(everything, state);

    expect(tuned.autoZoom).toBe(false);
    expect(tuned.preciseDetection).toBe(true);
    expect(tuned.sens).toBe('Moyenne');
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
    expect(decisionChanged(IDLE_AUTO_TUNE, run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP))))
      .toBe(true);
  });
});

describe('what Setup reads', () => {
  it('says nothing was taken before anything was measured', () => {
    expect(formatAutoTune(IDLE_AUTO_TUNE)).toBe('Rien retiré');
    expect(describeAutoTune(IDLE_AUTO_TUNE)).toContain('Lancez la surveillance');
  });

  it('names what was taken and the measurement behind it', () => {
    const state = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP));

    expect(formatAutoTune(state)).toBe('Zoom auto');
    // A capability that disappears without saying why reads as a bug.
    expect(describeAutoTune(state)).toContain('0,6 i/s');
    expect(describeAutoTune(state)).toContain('3,0 i/s');
  });

  it('distinguishes a step given back from one never taken', () => {
    const undone = run(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP)),
      behindFor(WINDOWS_TO_VERIFY));

    expect(formatAutoTune(undone)).toBe('Rien retiré');
    expect(describeAutoTune(undone)).toContain('n’y changeait rien');
  });
});

describe('when the platform says the phone is overheating', () => {
  it('acts on fewer windows than it would on the cadence alone', () => {
    // The thermal reading is a second, independent witness: waiting out the
    // usual evidence is six more seconds of a phone being clocked down while
    // it is supposed to be watching a door.
    expect(WINDOWS_TO_GIVE_UP_HOT).toBeLessThan(WINDOWS_TO_GIVE_UP);
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP_HOT), everything, HOT).applied)
      .toEqual(['autoZoom']);
    expect(run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP_HOT), everything, COOL).applied)
      .toEqual([]);
  });

  it('does not blacklist a step the heat is answering for', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP_HOT), everything, HOT);
    const verdict = run(given, behindFor(WINDOWS_TO_VERIFY), everything, HOT);

    // Given back, because it bought nothing — but not written off: the phone is
    // slower than itself, and the step never had a fair test.
    expect(verdict.applied).toEqual([]);
    expect(verdict.blocked).toEqual([]);
  });

  it('still writes off a step on a device that is merely slow', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP), everything, COOL);
    const verdict = run(given, behindFor(WINDOWS_TO_VERIFY), everything, COOL);

    expect(verdict.blocked).toEqual(['autoZoom']);
  });

  it('says the heat is the reason, and that it ends', () => {
    const given = run(IDLE_AUTO_TUNE, behindFor(WINDOWS_TO_GIVE_UP_HOT), everything, HOT);

    expect(describeAutoTune(given, HOT)).toContain('chaleur');
    expect(describeAutoTune(given, COOL)).toContain('0,6 i/s');
  });
});

describe('starting where the last session ended', () => {
  it('restores what that format had cost, and nothing else', () => {
    const seeded = seedFrom({ '4K': ['autoZoom', 'precise'] }, '4K', everything);

    expect(seeded.applied).toEqual(['autoZoom', 'precise']);
    // A starting point, not a verdict: nothing is pending, nothing is written
    // off, so a phone that has cooled down gives it all back on its own.
    expect(seeded.blocked).toEqual([]);
    expect(seeded.verify).toBe(0);
    expect(seeded.decided).toBeNull();
  });

  it('reads a format it has nothing for as a clean start', () => {
    expect(seedFrom({ '4K': ['autoZoom'] }, '1080p', everything)).toBe(IDLE_AUTO_TUNE);
    expect(seedFrom(null, '4K', everything)).toBe(IDLE_AUTO_TUNE);
  });

  it('drops what it cannot honour', () => {
    const stored = { '4K': ['autoZoom', 'precise', 'telepathy'] };
    // The detector is off, so "precise" would be the app taking credit for a
    // removal the user made; "telepathy" is a step some future version wrote.
    const settings = withSettings({ autoZoom: true, preciseDetection: false });

    expect(seedFrom(stored, '4K', settings).applied).toEqual(['autoZoom']);
  });

  it('is not read at all when self-tuning is switched off', () => {
    const off = withSettings({ autoTune: false });

    expect(seedFrom({ '4K': ['autoZoom'] }, '4K', off)).toBe(IDLE_AUTO_TUNE);
  });

  it('writes one entry per format, and drops an empty one', () => {
    const stored = { '4K': ['autoZoom'], '1080p': ['precise'] };

    expect(seedsWith(stored, '1080p', ['autoZoom', 'sensitivity']))
      .toEqual({ '4K': ['autoZoom'], '1080p': ['autoZoom', 'sensitivity'] });
    // "Nothing given up" is what no entry already means; keeping one would grow
    // the file with a row per quality the phone has ever recorded at.
    expect(seedsWith(stored, '1080p', [])).toEqual({ '4K': ['autoZoom'] });
  });
});
