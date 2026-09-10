/**
 * How long the camera is not filming between two clips of one passage.
 *
 * The duration cap ends a file without ending the passage, so a long passage
 * becomes consecutive clips — and between them there is a window nobody is
 * being recorded. It cannot be removed: VisionCamera offers no seamless
 * segmentation, so the encoder has to finalise one file before the next can
 * open. It can be measured, and it never had been: every figure this repo
 * carried about it came from fake timers, which say nothing about an encoder.
 *
 * Only a real device can answer, so the app measures itself and reports the
 * result in Setup → À propos. Nothing here is a fixture: the numbers come from
 * the two moments the JS side can actually observe.
 *
 * What the two halves mean, precisely — the distinction is the whole point of
 * splitting them:
 *
 * - `finalizeMs` runs from our `stopRecording()` to VisionCamera answering
 *   `onRecordingFinished`. That is the encoder closing the file, and it is not
 *   ours to shorten.
 * - `restartMs` runs from that answer to the next `startRecording()` returning.
 *   That one *is* ours, and it is where a stray `stat()` over the native bridge
 *   was found sitting.
 *
 * Neither endpoint is the instant the sensor stops or resumes delivering
 * frames, which no JS code can see. The sum brackets that window rather than
 * equalling it, so it is reported as what it is: the interval between the two
 * calls, not a certified count of lost footage.
 */

import { t, tn } from '../i18n';

export interface ClipGap {
  /** ms the encoder took to close the finished file. VisionCamera's to answer for. */
  finalizeMs: number;
  /** ms between the camera coming free and the next clip being open. Ours. */
  restartMs: number;
}

export interface ClipGapStats {
  /** How many cap cuts have been measured this session. */
  samples: number;
  /** The most recent measurement, for the split. */
  last: ClipGap | null;
  /** Sum of every gap, so a mean can be derived without keeping the samples. */
  totalMs: number;
  worstMs: number;
}

export const EMPTY_CLIP_GAP_STATS: ClipGapStats = {
  samples: 0, last: null, totalMs: 0, worstMs: 0,
};

export function gapTotal(gap: ClipGap): number {
  return gap.finalizeMs + gap.restartMs;
}

/**
 * Folds one measurement in.
 *
 * A negative or non-finite reading is dropped rather than averaged in: the
 * clock can jump (the user changing the time, an NTP correction) and a single
 * absurd sample would poison a mean that no longer keeps the values behind it.
 */
export function recordGap(stats: ClipGapStats, gap: ClipGap): ClipGapStats {
  const total = gapTotal(gap);
  if (!Number.isFinite(total) || gap.finalizeMs < 0 || gap.restartMs < 0) return stats;
  return {
    samples: stats.samples + 1,
    last: gap,
    totalMs: stats.totalMs + total,
    worstMs: Math.max(stats.worstMs, total),
  };
}

/** Mean gap in ms, or 0 before anything has been measured. */
export function meanGapMs(stats: ClipGapStats): number {
  return stats.samples > 0 ? stats.totalMs / stats.samples : 0;
}

function ms(value: number): string {
  if (value >= 1000) return (value / 1000).toFixed(2).replace('.', t('number.decimal')) + ' s';
  return Math.round(value) + ' ms';
}

/** The headline figure: the mean, which is what "the gap" means in practice. */
export function formatClipGap(stats: ClipGapStats): string {
  if (stats.samples === 0) return t('clipGap.none');
  return ms(meanGapMs(stats));
}

/**
 * The detail under it. Names which half is whose, because a large
 * `finalizeMs` and a large `restartMs` call for entirely different work.
 */
export function describeClipGap(stats: ClipGapStats): string | undefined {
  if (stats.samples === 0 || !stats.last) {
    return t('clipGap.tooShort');
  }
  return t('clipGap.detail', {
    cuts: tn('clipGap.cuts.other', stats.samples),
    worst: ms(stats.worstMs),
    finalize: ms(stats.last.finalizeMs),
    restart: ms(stats.last.restartMs),
  });
}
