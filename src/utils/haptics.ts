import { Vibration } from 'react-native';

/**
 * The one haptic in the app: starting or stopping surveillance.
 *
 * This is the action a phone is propped up and left for, and it is the one most
 * often taken without looking at the screen — reaching for a phone on a shelf,
 * on the way out of the door. A colour change is no answer there.
 *
 * It costs `android.permission.VIBRATE` in the manifest, which is a declaration
 * to Play like every other line in there (a normal permission: granted at
 * install, no dialog, no privacy question to answer). Nothing else in the app
 * vibrates — a notification channel's own vibration is the system's, not ours,
 * and needs no permission — so this file is the whole justification for it.
 *
 * 12 ms is a tick, not a buzz: long enough to feel through a case, short enough
 * that it is not a notification.
 */
const CONFIRM_MS = 12;

export function confirmTap(): void {
  Vibration.vibrate(CONFIRM_MS);
}
