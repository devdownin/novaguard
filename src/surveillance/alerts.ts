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

export function alertContent(kind: DetectionKind, at: number): { title: string; body: string } {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    title: t(kind === 'Personne' ? 'notif.person' : 'notif.animal'),
    body: t('notif.detail', { time }),
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
