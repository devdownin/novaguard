import { DetectionKind, Settings } from '../state/types';
import { pad } from '../utils/date';
import { t } from '../i18n';

/**
 * When a detection is worth interrupting someone for, and what the alert says.
 *
 * Pure so the rules are testable: the native side only ever gets a decision and
 * two strings.
 */

/**
 * Minimum gap between two alerts.
 *
 * Sessions are already throttled — the tracker needs several consecutive frames
 * before it confirms a subject, and it rides out brief occlusions — but someone
 * pacing in and out of frame would still open a new session each pass. A phone
 * buzzing every few seconds is a phone that gets silenced, which costs more
 * than the missed alerts.
 */
export const ALERT_COOLDOWN_MS = 60_000;

/**
 * Whether `at` falls in the quiet window, in local hours. `start` is included,
 * `end` is not; a window that wraps midnight (22 → 7) is the usual one, and a
 * window that starts where it ends is empty rather than the whole day — a
 * phone that never alerts is what the master switch is for.
 */
export function inQuietHours(start: number, end: number, at: number): boolean {
  const hour = new Date(at).getHours();
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * What a passage that comes back inside the cooldown does to the alert still on
 * screen. It used to do nothing: the second visit rang nothing, and said
 * nothing either, so one notification stood for a person who had since come
 * and gone three times.
 */
export const REPEAT_WINDOW_MS = 10 * 60_000;

/** The passages still inside the window, `now` included. Pure: the caller keeps the list. */
export function recentPassages(times: number[], now: number): number[] {
  return [...times.filter(at => now - at < REPEAT_WINDOW_MS), now];
}

export type AlertSettings = Pick<Settings, 'notif' | 'notifDet' | 'quietHours' | 'quietStart' | 'quietEnd'>;

/**
 * Quiet hours hold back the alert and nothing else: the passage is recorded
 * and filed as always, so the morning's history still has it.
 */
export function shouldAlert(
  settings: AlertSettings,
  lastAlertAt: number | null,
  now: number,
): boolean {
  if (!settings.notif || !settings.notifDet) return false;
  if (settings.quietHours && inQuietHours(settings.quietStart, settings.quietEnd, now)) return false;
  if (lastAlertAt == null) return true;
  return now - lastAlertAt >= ALERT_COOLDOWN_MS;
}

/**
 * Whether to update the alert already on screen, silently, rather than ring
 * again. Same conditions as `shouldAlert` except the cooldown, which is what
 * makes it the other half of the same decision: outside it, a passage rings;
 * inside it, it is counted.
 */
export function shouldRefreshAlert(
  settings: AlertSettings,
  lastAlertAt: number | null,
  now: number,
): boolean {
  if (lastAlertAt == null || now - lastAlertAt >= ALERT_COOLDOWN_MS) return false;
  // The switches and the quiet hours, with the cooldown taken out of it.
  return shouldAlert(settings, null, now);
}

/** `passages` is how many visits the last `REPEAT_WINDOW_MS` holds, this one included. */
export function alertContent(kind: DetectionKind, at: number, passages = 1): { title: string; body: string } {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    title: t(kind === 'Personne' ? 'notif.person' : 'notif.animal'),
    body: passages > 1
      ? t('notif.repeat', { time, count: passages, minutes: REPEAT_WINDOW_MS / 60_000 })
      : t('notif.detail', { time }),
  };
}

/**
 * The link a detection alert opens. Built natively from the passage id
 * (`DetectionNotifier`) and read back here, so the two only share this shape.
 */
const PASSAGE_URL = /^novaguard:\/\/passage\/([^/?#]+)$/;

export function passageIdFromUrl(url: string | null | undefined): string | null {
  const match = url ? PASSAGE_URL.exec(url) : null;
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
