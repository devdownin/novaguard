import { Linking, PermissionsAndroid } from 'react-native';
import NativeSurveillanceService from '../specs/NativeSurveillanceService';
import { PermissionOutcome } from '../state/types';
import { t } from '../i18n';

/**
 * Thin wrapper over the native foreground service.
 *
 * The module is null wherever the native side isn't there (Jest, a stale build
 * before codegen has run), so every call degrades to a no-op rather than
 * throwing: failing to promote the process is a downgrade in what surveillance
 * can do, not a reason to take the app down.
 */

export const NOTIFICATION_TITLE = t('notif.title');
export const NOTIFICATION_BODY =
  t('notif.monitoring');

/**
 * Starts the service, or — called again while it runs — rewrites what its
 * notification says.
 *
 * `startForeground` with the same id updates the standing notification rather
 * than posting a second one, which makes this the only surface the app has
 * while the screen is off. That is what a camera interrupted mid-watch has to
 * reach: the viewfinder's error chip is drawn where nobody is looking.
 */
export function startForegroundService(body: string = NOTIFICATION_BODY): boolean {
  if (!NativeSurveillanceService) return false;
  try {
    NativeSurveillanceService.start(NOTIFICATION_TITLE, body);
    return true;
  } catch {
    return false;
  }
}

export function stopForegroundService(): void {
  if (!NativeSurveillanceService) return;
  try {
    NativeSurveillanceService.stop();
  } catch {
    // Already gone, or the process is being torn down anyway.
  }
}

/**
 * Why the foreground service refused to start, or null.
 *
 * `startForegroundService` only queues the start; everything that can go wrong
 * — a missing camera permission, a foreground-service type Android will not
 * grant from the current state — happens later, inside the service. It cannot
 * surface as a thrown error here, so the service records it and we read it back.
 */
export function foregroundServiceError(): string | null {
  if (!NativeSurveillanceService) return null;
  try {
    return NativeSurveillanceService.lastError() || null;
  } catch {
    return null;
  }
}

/**
 * What the platform says about heat and power, or "unknown".
 *
 * Read through the same wrapper as everything else on this module: null under
 * Jest and on a build where codegen has not run, and a device whose OEM does
 * not implement thermal reporting answers -1. Both mean the self-tuning loop
 * falls back to the cadence measurement it already had — never to an
 * exception on the frame path.
 */
export function thermalStatus(): number {
  if (!NativeSurveillanceService) return -1;
  try {
    return NativeSurveillanceService.thermalStatus();
  } catch {
    return -1;
  }
}

export function batteryLevel(): number {
  if (!NativeSurveillanceService) return -1;
  try {
    return NativeSurveillanceService.batteryLevel();
  } catch {
    return -1;
  }
}

export function isCharging(): boolean {
  if (!NativeSurveillanceService) return false;
  try {
    return NativeSurveillanceService.isCharging();
  } catch {
    return false;
  }
}

export function isForegroundServiceRunning(): boolean {
  if (!NativeSurveillanceService) return false;
  try {
    return NativeSurveillanceService.isRunning();
  } catch {
    return false;
  }
}

export function notifyDetection(title: string, body: string): void {
  if (!NativeSurveillanceService) return;
  try {
    NativeSurveillanceService.notifyDetection(title, body);
  } catch {
    // An alert that fails to post is not worth interrupting surveillance for.
  }
}

export function dismissDetectionAlert(): void {
  if (!NativeSurveillanceService) return;
  try {
    NativeSurveillanceService.dismissDetection();
  } catch {
    // Nothing to clear, or the notification manager is gone.
  }
}

/**
 * Offers one clip to another app, at the user's request.
 *
 * The only way anything recorded here leaves the device, and it takes a tap:
 * clips are written to the app's private directory, which no other app can
 * read. False means nothing was opened — the file is gone, or the device has
 * nothing that accepts a video — and the caller is expected to say so.
 */
export function shareRecording(path: string): boolean {
  if (!NativeSurveillanceService) return false;
  try {
    return NativeSurveillanceService.shareRecording(path);
  } catch {
    return false;
  }
}

/**
 * A still decoded from a clip already on disk, or null.
 *
 * Asked for only when the snapshot taken as the clip opened came back empty —
 * the screen-off case. Null is an ordinary answer here, not an error: a clip
 * whose frames will not decode, and every build with no native side at all.
 */
export async function extractThumbnail(clipPath: string): Promise<string | null> {
  if (!NativeSurveillanceService) return null;
  try {
    return (await NativeSurveillanceService.extractThumbnail(clipPath)) || null;
  } catch {
    return null;
  }
}

/** Android owns sound and vibration per channel; this is where the user sets them. */
export function openDetectionChannelSettings(): void {
  if (!NativeSurveillanceService) return;
  try {
    NativeSurveillanceService.openDetectionChannelSettings();
  } catch {
    // Deep link unavailable on this device — nothing better to fall back to.
  }
}

/**
 * The service runs whether or not this is granted — but its notification is
 * silently withheld without it, which would leave the camera running with no
 * visible indication. Asked for at the same moment as the other permissions.
 */
export async function requestNotificationPermission(): Promise<PermissionOutcome> {
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    // Told apart from a plain refusal on purpose: Android shows no dialog at
    // all once this is the answer, so a caller that collapsed the two into
    // `false` could only offer a button that does nothing you can see.
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Opens this app's page in Android settings.
 *
 * The only way back once a permission is refused for good — the in-app request
 * returns immediately and shows nothing. Distinct from
 * {@link openDetectionChannelSettings}, which tunes a channel the app is
 * already allowed to post on.
 */
export function openAppSettings(): void {
  try {
    Linking.openSettings();
  } catch {
    // Nothing better to fall back to; the caller has already said what it wants.
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch {
    return false;
  }
}
