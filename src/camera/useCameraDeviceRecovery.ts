import { useEffect } from 'react';
import { refreshCameraDevices } from '../surveillance/foregroundService';

/** Once a second, for this many seconds: CameraX is normally ready well within it. */
export const DEVICE_REFRESH_INTERVAL_MS = 1000;
export const DEVICE_REFRESH_ATTEMPTS = 15;

/**
 * Asks VisionCamera for its camera list again while the app has none.
 *
 * VisionCamera 4.7 reads the list before CameraX has initialised and never
 * emits it again afterwards; on the new architecture that left the app with
 * zero cameras for good, and the viewfinder saying so. Re-emitting is cheap
 * and idempotent, so it is asked for until a device appears or the attempts
 * run out — and again whenever surveillance is (re)started.
 */
export function useCameraDeviceRecovery(missing: boolean, restartKey: unknown): void {
  useEffect(() => {
    if (!missing) return;
    let attempts = 0;
    refreshCameraDevices();
    const timer = setInterval(() => {
      attempts += 1;
      refreshCameraDevices();
      if (attempts >= DEVICE_REFRESH_ATTEMPTS) clearInterval(timer);
    }, DEVICE_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [missing, restartKey]);
}
