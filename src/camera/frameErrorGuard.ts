import type { ErrorUtils } from 'react-native';
import { frameErrorMessage, isFrameProcessorError } from './frameErrors';

/**
 * Backstop for frame-processor errors the frame processor's own `try` cannot see.
 *
 * `CameraFeed` wraps its worklet body, which covers everything the analysis does
 * per frame. It cannot cover what happens *around* that body: a closure the
 * worklets runtime refuses to copy throws while the worklet is being installed,
 * and VisionCamera raises its own errors outside our code. Those still reach
 * `throwErrorOnJS` → `reportFatalError`, which closes the app.
 *
 * So this narrows the global handler rather than replacing it: an error carrying
 * VisionCamera's marker becomes a message, and **everything else is handed to
 * the handler that was already installed**. A guard that swallowed the rest
 * would turn every real crash into a silently broken app, which is a worse
 * failure than the one it set out to fix.
 */
export function installFrameErrorGuard(report: (message: string) => void): () => void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils;
  // No global handler outside a React Native runtime (Jest, a bare Node script).
  if (errorUtils?.setGlobalHandler == null) return () => {};

  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (isFrameProcessorError(error)) {
      report(frameErrorMessage(error));
      return;
    }
    previous?.(error, isFatal);
  });

  return () => errorUtils.setGlobalHandler(previous);
}
