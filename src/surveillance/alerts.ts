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

export function shouldAlert(
  settings: Pick<Settings, 'notif' | 'notifDet'>,
  lastAlertAt: number | null,
  now: number,
): boolean {
  if (!settings.notif || !settings.notifDet) return false;
  if (lastAlertAt == null) return true;
  return now - lastAlertAt >= ALERT_COOLDOWN_MS;
}

export function alertContent(kind: DetectionKind, at: number): { title: string; body: string } {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return {
    title: t(kind === 'Personne' ? 'notif.person' : 'notif.animal'),
    body: `À ${time} · enregistrement en cours`,
  };
}
