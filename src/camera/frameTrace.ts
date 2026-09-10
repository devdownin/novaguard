/**
 * Which native call the analysis was inside when the process died.
 *
 * Some failures cannot be caught. The frame processor's `try` covers every
 * JavaScript error, and `frameErrorGuard` covers what escapes it — but a
 * segfault or an abort inside libyuv, LiteRT or ML Kit ends the process before
 * any of that runs. The app does not close gracefully; it stops existing. There
 * is nothing left on screen to read, and nothing written down.
 *
 * So the analysis writes down what it is *about* to do, before doing it. A
 * stage persisted with no completion after it means the app died in that call.
 * "resize" is not "resize succeeded" — it is "resize was entered".
 *
 * That ordering is the whole design. Recording success would name the last
 * thing that worked, which is precisely the thing that is not the problem.
 *
 * It is a best effort, not a guarantee: the worklet hops to the JS thread to
 * write, so a call that dies within microseconds of being entered can beat the
 * write to disk. What it does catch is the failure that repeats — which is the
 * one worth naming, and the one a user can neither see nor report.
 */

import { StringKey, t } from '../i18n';

/**
 * The native steps surveillance goes through, in the order it takes them.
 *
 * `camera` is CameraX opening a session and starting to deliver frames; the
 * other three are one analysed frame, each a different library reaching into
 * the same buffer and each able to take the process down without passing
 * through JavaScript — `resize` is libyuv over the raw planes, `inference` is
 * LiteRT, and `faces` hands the frame to ML Kit.
 *
 * `camera` earns its place: without it, a session that died before the first
 * frame ever reached the worklet would leave nothing behind at all.
 */
export const FRAME_STAGES = ['camera', 'resize', 'inference', 'faces', 'report'] as const;

export type FrameStage = (typeof FRAME_STAGES)[number];

/** True when `stage` comes later in the pipeline than `previous`. */
export function isLaterStage(stage: FrameStage, previous: FrameStage | null): boolean {
  if (previous == null) return true;
  return FRAME_STAGES.indexOf(stage) > FRAME_STAGES.indexOf(previous);
}

/** Whether a frame that reached `stage` got all the way through the analysis. */
export function isCompleteFrame(stage: FrameStage | null): boolean {
  return stage === FRAME_STAGES[FRAME_STAGES.length - 1];
}

const BLAME: Record<FrameStage, StringKey> = {
  camera: 'stage.camera',
  resize: 'stage.resize',
  inference: 'stage.inference',
  faces: 'stage.faces',
  report: 'stage.report',
};

/**
 * What to tell the user about a session that never came back.
 *
 * Worded so it starts with `error.prefix.frame`, because `reportCameraProblem`
 * clears only messages beginning with it: a diagnosis worded past that match
 * would sit in the viewfinder for the rest of the session, long after a frame
 * proved the camera can get through one. That coupling is why the prefixes live
 * in the catalogue, next to the sentences built on them.
 */
export function stageDiagnosis(stage: FrameStage | null): string | null {
  if (stage == null || isCompleteFrame(stage)) return null;
  return t('error.frame.duringStage', { stage: t(BLAME[stage]) });
}

/** Parses a persisted stage, rejecting anything a older or corrupt build wrote. */
export function parseStage(value: unknown): FrameStage | null {
  return FRAME_STAGES.includes(value as FrameStage) ? (value as FrameStage) : null;
}
