/**
 * The series behind the verdict.
 *
 * `autoTune.ts` knows what is given up now; this is what lets the app show
 * *when*, and against which cadence. Three things have to hold for the screen
 * that draws it to be honest: the buffer stays bounded (it is fed from the
 * frame path and would otherwise grow all night), a step the user switched off
 * is never recorded as one the app took away, and the snapshot a chart renders
 * from does not keep growing underneath it.
 *
 * @format
 */

import {
  AUTO_TUNE_LOG_SIZE, AutoTuneSample, cadenceSeries, currentTarget, emptyAutoTuneLog, meanCadence,
  pushSample, readSamples, sampleSteps, stepSeries, stepUptime,
} from '../src/camera/autoTuneLog';
import { barHeights, CHART_HEIGHT, MIN_BAR_HEIGHT } from '../src/components/BarChart';
import { AutoTuneState, IDLE_AUTO_TUNE } from '../src/camera/autoTune';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

const withSettings = (over: Partial<Settings>): Settings => ({ ...defaultSettings, ...over });
const everything = withSettings({ autoZoom: true, sens: 'Moyenne', preciseDetection: true });
const given = (...applied: AutoTuneState['applied']): AutoTuneState => ({ ...IDLE_AUTO_TUNE, applied });

const sample = (measured: number, state = IDLE_AUTO_TUNE, settings = everything): AutoTuneSample =>
  ({ measured, target: 3, steps: sampleSteps(state, settings) });

describe('the buffer', () => {
  it('keeps the most recent windows and drops the rest', () => {
    const log = emptyAutoTuneLog();

    for (let i = 0; i < AUTO_TUNE_LOG_SIZE + 25; i++) pushSample(log, sample(i));

    const samples = readSamples(log);
    expect(samples).toHaveLength(AUTO_TUNE_LOG_SIZE);
    // Oldest first, and the oldest 25 are gone rather than the newest.
    expect(samples[0].measured).toBe(25);
    expect(samples[samples.length - 1].measured).toBe(AUTO_TUNE_LOG_SIZE + 24);
  });

  it('hands out a snapshot, not the buffer', () => {
    const log = emptyAutoTuneLog();
    pushSample(log, sample(1));

    const snapshot = readSamples(log);
    pushSample(log, sample(2));

    // A chart whose data grows while it renders disagrees with its own labels.
    expect(snapshot).toHaveLength(1);
    expect(readSamples(log)).toHaveLength(2);
  });
});

describe('what a window says about each step', () => {
  it('separates given up from switched off', () => {
    const state = given('autoZoom');
    const settings = withSettings({ autoZoom: true, sens: 'Basse', preciseDetection: false });

    // The app took the auto-zoom; the user had already declined the detector,
    // and "Basse" leaves no notch to step down to. Drawing all three as
    // "absent" would credit the app with two removals it did not make.
    expect(sampleSteps(state, settings)).toEqual(['given', 'off', 'off']);
  });

  it('reads a step the user asked for and nobody removed as on', () => {
    expect(sampleSteps(IDLE_AUTO_TUNE, everything)).toEqual(['on', 'on', 'on']);
  });

  it('reports the tuner first, even for a step the user also has off', () => {
    const settings = withSettings({ autoZoom: false, sens: 'Moyenne', preciseDetection: true });

    expect(sampleSteps(given('autoZoom'), settings)).toEqual(['given', 'on', 'on']);
  });
});

describe('the series a chart is drawn from', () => {
  const samples = [
    sample(3),
    sample(1, given('autoZoom')),
    sample(2.5, given('autoZoom')),
  ];

  it('follows one step through the windows', () => {
    expect(stepSeries('autoZoom', samples)).toEqual(['on', 'given', 'given']);
    expect(stepSeries('precise', samples)).toEqual(['on', 'on', 'on']);
  });

  it('counts the windows a step actually ran in', () => {
    expect(stepUptime('autoZoom', samples)).toEqual({ on: 1, total: 3 });
  });

  it('carries the cadence and its summary', () => {
    expect(cadenceSeries(samples)).toEqual([3, 1, 2.5]);
    expect(meanCadence(samples)).toBeCloseTo(6.5 / 3);
    expect(currentTarget(samples)).toBe(3);
  });

  it('answers for an empty log without dividing by nothing', () => {
    expect(meanCadence([])).toBe(0);
    expect(currentTarget([])).toBe(0);
    expect(stepUptime('precise', [])).toEqual({ on: 0, total: 0 });
  });
});

describe('bar heights', () => {
  it('scales against the given maximum, not the tallest bar', () => {
    // Scaling to the tallest value would answer "does it reach the target?"
    // with yes, always.
    expect(barHeights([0, 1.5, 3], 3, CHART_HEIGHT)).toEqual([MIN_BAR_HEIGHT, 22, 44]);
  });

  it('draws a zero as a stub, never as nothing', () => {
    // "The value was zero" and "there is no measurement" are different
    // statements; blank space says the second.
    expect(barHeights([0], 5)).toEqual([MIN_BAR_HEIGHT]);
  });

  it('never draws past the top of the scale', () => {
    expect(barHeights([9], 3, CHART_HEIGHT)).toEqual([CHART_HEIGHT]);
  });

  it('survives a scale of zero, which is what an unmeasured window has', () => {
    expect(barHeights([0, 0], 0)).toEqual([MIN_BAR_HEIGHT, MIN_BAR_HEIGHT]);
  });
});
