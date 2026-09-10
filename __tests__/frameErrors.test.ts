/**
 * A frame-processor failure has to become a message, not a closed app.
 *
 * VisionCamera rethrows anything a frame processor raises onto the JS thread
 * with `reportFatalError`, so one bad frame ends the process in a release
 * build. That is how both worklet bugs in `workletSafety.test.ts` presented on
 * a device: the preview appeared, then NovaGuard was gone.
 *
 * The narrowing is the whole point of these tests. A guard that downgraded
 * every error would turn any real crash into an app that looks alive and does
 * nothing, which is worse than the failure it replaces.
 *
 * @format
 */

/// <reference types="node" />

import type { ErrorUtils } from 'react-native';
import { installFrameErrorGuard } from '../src/camera/frameErrorGuard';
import {
  FRAME_ERROR_PREFIX, FRAME_PROCESSOR_ERROR_NAME, frameErrorMessage, isFrameProcessorError,
} from '../src/camera/frameErrors';

/** An error shaped exactly like the one VisionCamera's throwErrorOnJS builds. */
function frameProcessorError(message: string): Error {
  const error = new Error(message);
  error.name = FRAME_PROCESSOR_ERROR_NAME;
  (error as Error & { jsEngine: string }).jsEngine = 'VisionCamera';
  return error;
}

describe('recognising a frame-processor error', () => {
  it('accepts the shape VisionCamera rethrows', () => {
    expect(isFrameProcessorError(frameProcessorError('boom'))).toBe(true);
  });

  it('accepts one whose name was lost but which still names the engine', () => {
    expect(isFrameProcessorError({ jsEngine: 'VisionCamera', message: 'boom' })).toBe(true);
  });

  it('leaves every other error alone', () => {
    expect(isFrameProcessorError(new TypeError('undefined is not a function'))).toBe(false);
    expect(isFrameProcessorError('a bare string')).toBe(false);
    expect(isFrameProcessorError(null)).toBe(false);
    expect(isFrameProcessorError(undefined)).toBe(false);
  });
});

describe('the message it puts in the viewfinder', () => {
  it('keeps only the first line', () => {
    // The real ones carry the whole worklet source after the first sentence.
    const message = frameErrorMessage(new Error("Regular javascript function 'x' cannot be shared.\nfunction x() {"));
    expect(message).toBe(`${FRAME_ERROR_PREFIX} d'image : Regular javascript function 'x' cannot be shared.`);
  });

  it('does not put a stack trace in a 10 pt chip', () => {
    const message = frameErrorMessage(new Error('e'.repeat(400)));
    expect(message.length).toBeLessThan(160);
    expect(message.endsWith('…')).toBe(true);
  });

  it('still says something when there is no message at all', () => {
    expect(frameErrorMessage(new Error(''))).toContain(FRAME_ERROR_PREFIX);
    expect(frameErrorMessage(undefined)).toContain(FRAME_ERROR_PREFIX);
  });

  it('starts with the prefix the camera uses to clear its own banner', () => {
    // `reportCameraProblem` matches on it; a message that did not carry it
    // would sit in the viewfinder for ever, long after the camera recovered.
    expect(frameErrorMessage(new Error('boom')).startsWith(FRAME_ERROR_PREFIX)).toBe(true);
  });
});

describe('the global handler guard', () => {
  const original = (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils;
  let handler: ((error: unknown, isFatal?: boolean) => void) | undefined;
  let previous: jest.Mock;

  beforeEach(() => {
    previous = jest.fn();
    handler = previous;
    (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils = {
      setGlobalHandler: fn => { handler = fn; },
      getGlobalHandler: () => handler!,
    } as ErrorUtils;
  });

  afterEach(() => {
    (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils = original;
  });

  it('turns a frame-processor error into a report instead of a crash', () => {
    const report = jest.fn();
    installFrameErrorGuard(report);

    handler!(frameProcessorError('Set.prototype.has called on incompatible receiver'), true);

    expect(report).toHaveBeenCalledWith(
      `${FRAME_ERROR_PREFIX} d'image : Set.prototype.has called on incompatible receiver`,
    );
    expect(previous).not.toHaveBeenCalled();
  });

  it('hands every other error to the handler that was already there', () => {
    // Without this the guard would swallow real crashes, and an app that is
    // alive but broken is harder to diagnose than one that died.
    const report = jest.fn();
    installFrameErrorGuard(report);

    const other = new TypeError('a genuine bug');
    handler!(other, true);

    expect(report).not.toHaveBeenCalled();
    expect(previous).toHaveBeenCalledWith(other, true);
  });

  it('puts the previous handler back when uninstalled', () => {
    const uninstall = installFrameErrorGuard(jest.fn());
    uninstall();
    expect(handler).toBe(previous);
  });

  it('is a no-op where there is no global handler at all', () => {
    delete (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils;
    expect(() => installFrameErrorGuard(jest.fn())()).not.toThrow();
  });
});
