/**
 * The measurement of the window between two clips of one passage.
 *
 * The gap itself cannot be shortened away — VisionCamera offers no seamless
 * segmentation — so what matters is that the figure reported is real. Every
 * number this repo has ever carried about it came from fake timers, which say
 * nothing about an encoder; these tests cover the arithmetic that turns two
 * observed instants into something a person can read.
 *
 * @format
 */

import {
  ClipGapStats, describeClipGap, EMPTY_CLIP_GAP_STATS, formatClipGap, gapTotal,
  meanGapMs, recordGap,
} from '../src/recording/clipGap';

const gap = (finalizeMs: number, restartMs: number) => ({ finalizeMs, restartMs });

/** Folds a run of measurements in, oldest first. */
const fold = (...gaps: { finalizeMs: number; restartMs: number }[]): ClipGapStats =>
  gaps.reduce(recordGap, EMPTY_CLIP_GAP_STATS);

describe('recording a measurement', () => {
  it('counts both halves towards the gap', () => {
    // The split is the point: one half is VisionCamera's, the other is ours.
    expect(gapTotal(gap(300, 40))).toBe(340);
  });

  it('keeps the mean, the worst and the split', () => {
    const stats = fold(gap(300, 40), gap(500, 60), gap(200, 20));

    expect(stats.samples).toBe(3);
    expect(meanGapMs(stats)).toBeCloseTo((340 + 560 + 220) / 3);
    expect(stats.worstMs).toBe(560);
    expect(stats.last).toEqual(gap(200, 20));
  });

  it('drops a reading the clock made nonsense of', () => {
    // Date.now() can jump backwards — the user changing the time, an NTP
    // correction — and the samples are not kept, so one absurd value would sit
    // in the mean permanently with no way to take it back out.
    const good = fold(gap(300, 40));
    expect(recordGap(good, gap(-90_000, 10))).toBe(good);
    expect(recordGap(good, gap(10, Number.NaN))).toBe(good);
    expect(recordGap(good, gap(Number.POSITIVE_INFINITY, 0))).toBe(good);
  });

  it('starts from nothing measured, not from zero measured', () => {
    // "0 ms" would read as a gap that does not exist, which is the one claim
    // this feature must never make on its own.
    expect(formatClipGap(EMPTY_CLIP_GAP_STATS)).toBe('Pas encore mesuré');
    expect(meanGapMs(EMPTY_CLIP_GAP_STATS)).toBe(0);
    expect(describeClipGap(EMPTY_CLIP_GAP_STATS)).toMatch(/plus long que la durée max/);
  });
});

describe('reading it back', () => {
  it('reports the mean as the headline figure', () => {
    expect(formatClipGap(fold(gap(300, 40), gap(500, 60)))).toBe('450 ms');
  });

  it('switches to seconds once the gap stops being small', () => {
    // "1400 ms" is a number; "1,40 s" is an amount of lost footage.
    expect(formatClipGap(fold(gap(1200, 200)))).toBe('1,40 s');
  });

  it('names which half is whose', () => {
    const detail = describeClipGap(fold(gap(300, 40), gap(500, 60)))!;

    expect(detail).toContain('2 coupures');
    expect(detail).toContain('pire 560 ms');
    // A large finalisation and a large restart call for entirely different
    // work, so the two are never presented as one number.
    expect(detail).toContain('500 ms de finalisation');
    expect(detail).toContain('60 ms de relance');
  });

  it('counts a single cut in the singular', () => {
    expect(describeClipGap(fold(gap(300, 40)))).toContain('1 coupure ');
  });
});
