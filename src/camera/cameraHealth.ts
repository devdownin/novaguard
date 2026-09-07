/**
 * What the app does when the camera session dies under it.
 *
 * A capture session is not something this app owns for good: an incoming call,
 * another app that opens the camera, an OEM policy that reclaims it — CameraX
 * hands back an error and stops delivering frames. Until now that error only
 * painted a line of text in a corner of the viewfinder, which is the one place
 * nobody is looking: a surveillance phone spends its life with the screen off.
 * The notification went on saying "surveillance active", the status pill went
 * on saying it too, nothing was being filmed and nothing tried again.
 *
 * So the interruption becomes a state, with three properties:
 *  - it is *said*, on the surface that survives a dark screen — the service's
 *    own notification;
 *  - it is retried, because the app that took the camera will give it back and
 *    a camera that stopped trying is a camera that is off;
 *  - it ends on a frame, not on a restart. Re-mounting the camera proves
 *    nothing; an image arriving proves everything.
 */

export type CameraHealth = 'healthy' | 'interrupted';

export interface CameraRecovery {
  health: CameraHealth;
  /** Restarts attempted since the camera last delivered a frame. */
  attempts: number;
}

export const HEALTHY_CAMERA: CameraRecovery = { health: 'healthy', attempts: 0 };

/**
 * How long to wait before the next restart, by attempt number.
 *
 * The first attempts are quick, because the common cause — a phone call, a
 * banking app checking a face — is over in seconds. They then back off to
 * `RETRY_CEILING_MS` and stay there forever rather than giving up: a camera
 * held by another app for an hour is still worth taking back at the end of it,
 * and a surveillance app that has stopped trying is indistinguishable from one
 * that is switched off — except that this one still claims to be watching.
 */
const RETRY_STEPS_MS = [2_000, 4_000, 8_000, 16_000];
export const RETRY_CEILING_MS = 30_000;

export function retryDelayFor(attempts: number): number {
  return RETRY_STEPS_MS[attempts] ?? RETRY_CEILING_MS;
}

/** The camera reported an error. Nothing to do if it was already down. */
export function cameraFailed(recovery: CameraRecovery): CameraRecovery {
  return recovery.health === 'interrupted' ? recovery : { health: 'interrupted', attempts: 0 };
}

/** One restart has been asked for; the next one waits longer. */
export function cameraRetried(recovery: CameraRecovery): CameraRecovery {
  return { health: 'interrupted', attempts: recovery.attempts + 1 };
}

/**
 * A frame arrived. Only *this* clears the interruption: a session that mounts
 * and then delivers nothing is exactly what the failure looks like from here.
 */
export function cameraDeliveredFrame(recovery: CameraRecovery): CameraRecovery {
  return recovery.health === 'healthy' ? recovery : HEALTHY_CAMERA;
}
