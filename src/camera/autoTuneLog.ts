/**
 * The history behind the self-tuning decisions, kept so the app can show its
 * own reasoning rather than only its verdict.
 *
 * `autoTune.ts` holds one state: what is given up now, and the measurement that
 * decided it. That is enough to act on and not enough to read — "Zoom auto
 * retiré, 1,4 i/s sur 5" says nothing about whether the phone has been
 * struggling for two seconds or two minutes, nor whether giving it up moved
 * anything. This is the series under that verdict.
 *
 * Bounded, mutated in place, and never rendered from directly. One sample is
 * appended per closed frame-rate window — every two seconds, on the frame path
 * — so publishing it through React state would re-render the provider at that
 * cadence, which is the cost the whole context split exists to avoid. The
 * screen that draws it polls instead, and only while it is open.
 *
 * Each sample carries a state per step rather than a flag, because there are
 * three ways a step can be absent from a window and a chart that drew one bar
 * for all of them would show the app removing something its owner had already
 * switched off.
 */

import { Settings } from '../state/types';
import { AUTO_TUNE_LADDER, AutoTuneState, AutoTuneStep } from './autoTune';

/**
 * Two minutes at one window every two seconds.
 *
 * Long enough to hold a decision, its verification and the beginning of a
 * recovery — the shortest stretch in which the loop's behaviour is legible —
 * and short enough that the whole log is one small array.
 */
export const AUTO_TUNE_LOG_SIZE = 60;

export interface AutoTuneSample {
  /** Cadence measured over the window, in frames per second. */
  measured: number;
  /** Cadence "Sensibilité" asked for during that window. */
  target: number;
  /** What each ladder step was doing, in {@link AUTO_TUNE_LADDER} order. */
  steps: readonly StepState[];
}

export interface AutoTuneLog {
  samples: AutoTuneSample[];
}

/** What a ladder step was doing during one window. */
export type StepState = 'on' | 'given' | 'off';

export function emptyAutoTuneLog(): AutoTuneLog {
  return { samples: [] };
}

/** Whether the user asked for this step at all. */
function chosen(step: AutoTuneStep, settings: Settings): boolean {
  return step === 'autoZoom' ? settings.autoZoom : settings.preciseDetection;
}

/**
 * What each step is doing right now.
 *
 * The tuner's verdict is read first: while a step is given up, whether the user
 * would also have it on is not what the window shows. And `off` is kept
 * distinct from `given` because the app must never be shown removing something
 * its owner had already switched off.
 */
export function sampleSteps(state: AutoTuneState, settings: Settings): StepState[] {
  return AUTO_TUNE_LADDER.map(step => (
    state.applied.includes(step) ? 'given' : chosen(step, settings) ? 'on' : 'off'
  ));
}

/**
 * Appends one window. Mutates by design — this runs on the frame path, and the
 * array is the ring buffer, not a value anything renders from.
 */
export function pushSample(log: AutoTuneLog, sample: AutoTuneSample): void {
  log.samples.push(sample);
  const overflow = log.samples.length - AUTO_TUNE_LOG_SIZE;
  if (overflow > 0) log.samples.splice(0, overflow);
}

/**
 * A snapshot to draw, oldest first.
 *
 * A copy rather than the buffer itself: the frame path keeps appending while
 * the screen renders, and a chart whose data grows underneath it is a chart
 * that disagrees with its own labels.
 */
export function readSamples(log: AutoTuneLog): AutoTuneSample[] {
  return log.samples.slice();
}

export function cadenceSeries(samples: readonly AutoTuneSample[]): number[] {
  return samples.map(s => s.measured);
}

export function stepSeries(
  step: AutoTuneStep,
  samples: readonly AutoTuneSample[],
): StepState[] {
  const index = AUTO_TUNE_LADDER.indexOf(step);
  // Samples written before a step existed have nothing to say about it; `on`
  // would be a claim, so they are read as what they are — not measured.
  return samples.map(s => s.steps[index] ?? 'off');
}

/** Windows the step actually ran in, and how many were measured at all. */
export function stepUptime(
  step: AutoTuneStep,
  samples: readonly AutoTuneSample[],
): { on: number; total: number } {
  const series = stepSeries(step, samples);
  return { on: series.filter(state => state === 'on').length, total: series.length };
}

export function meanCadence(samples: readonly AutoTuneSample[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, s) => sum + s.measured, 0) / samples.length;
}

/** The cadence asked for as of the last window, which is what the chart scales to. */
export function currentTarget(samples: readonly AutoTuneSample[]): number {
  return samples.length > 0 ? samples[samples.length - 1].target : 0;
}
