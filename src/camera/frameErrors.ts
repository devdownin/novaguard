/**
 * Turning a frame-processor failure into a message instead of a dead process.
 *
 * An error raised inside the frame processor does not stay there. VisionCamera
 * catches it on the worklet thread and hands it to `throwErrorOnJS`, which
 * rebuilds it on the JS thread and calls React Native's `reportFatalError` —
 * so in a release build, one bad frame closes the app. That is exactly how the
 * two worklet bugs in `__tests__/workletSafety.test.ts` presented: the preview
 * appeared, then NovaGuard was gone, with nothing on screen to say why.
 *
 * Detection failing is a degraded camera, not a reason to stop being a
 * surveillance app. These helpers are what lets the viewfinder say so instead.
 *
 * Pure on purpose — the wiring lives in `frameErrorGuard.ts`.
 */

import { t } from '../i18n';

/** The `name` VisionCamera stamps on an error it rethrows onto the JS thread. */
export const FRAME_PROCESSOR_ERROR_NAME = 'Frame Processor Error';

/** …and the `jsEngine` it sets alongside it, which survives a name being lost. */
const FRAME_PROCESSOR_ENGINE = 'VisionCamera';

/**
 * Prefix every frame-processor message carries.
 *
 * `reportCameraProblem` clears only the messages it owns, and matches on this,
 * so a frame processor that recovers takes its own banner down without wiping
 * an unrelated recording or foreground-service message.
 */
export const FRAME_ERROR_PREFIX = t('error.prefix.frame');

/**
 * True for the errors VisionCamera rethrows out of a frame processor, and only
 * those. Anything else has to keep crashing the way it did: a global handler
 * that swallowed everything would trade one silent failure for a much larger one.
 */
export function isFrameProcessorError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; jsEngine?: unknown };
  return candidate.name === FRAME_PROCESSOR_ERROR_NAME || candidate.jsEngine === FRAME_PROCESSOR_ENGINE;
}

/** Longest message kept; past this it is a stack trace in a 10 pt chip. */
const MAX_MESSAGE = 120;

/**
 * A one-line French message for the viewfinder.
 *
 * Only the first line is kept: these messages routinely carry the whole worklet
 * source ("Regular javascript function 'x' cannot be shared. Try decorating…"),
 * and the first sentence is the part that names the fault.
 */
export function frameErrorMessage(error: unknown): string {
  const raw = typeof error === 'string'
    ? error
    : (error as { message?: unknown } | null)?.message;
  const text = (typeof raw === 'string' ? raw : '').split('\n')[0].trim();
  if (!text) return t('error.frame.interrupted');
  const clipped = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
  return t('error.frame.detail', { message: clipped });
}
