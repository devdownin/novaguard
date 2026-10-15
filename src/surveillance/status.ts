import { CameraHealth } from '../camera/cameraHealth';
import { StringKey } from '../i18n/fr';
import { t } from '../i18n';
import { formatTimeOfDay } from '../utils/date';
import { color } from '../theme';

export type SurveillanceStatus = 'inactive' | 'starting' | 'active' | 'recording' |
  'camera-unavailable' | 'storage-insufficient' | 'analysis-unavailable' | 'recording-error';

export function surveillanceStatusOf(input: {
  monitoring: boolean; recording: boolean; cameraPermission: boolean; cameraHealth: CameraHealth;
  analysisProblem: string | null; recordingProblem: string | null; otherProblem: string | null;
  lowStorage: boolean; hasFrame: boolean; ready: boolean;
}): SurveillanceStatus {
  if (!input.monitoring) return input.recording ? 'recording' : 'inactive';
  if (!input.cameraPermission || input.cameraHealth === 'interrupted') return 'camera-unavailable';
  if (input.analysisProblem) return 'analysis-unavailable';
  if (input.lowStorage || (input.recordingProblem && /Espace insuffisant|ENOSPC|no.space|insufficient.space/i.test(input.recordingProblem))) return 'storage-insufficient';
  if (input.recordingProblem || input.otherProblem) return 'recording-error';
  if (!input.hasFrame || !input.ready) return 'starting';
  return input.recording ? 'recording' : 'active';
}

export const STATUS_LABEL: Record<SurveillanceStatus, StringKey> = {
  inactive: 'surv.status.off', starting: 'surv.status.starting', active: 'surv.status.on',
  recording: 'surv.status.recording', 'camera-unavailable': 'surv.status.cameraUnavailable',
  'storage-insufficient': 'surv.status.storage', 'analysis-unavailable': 'surv.status.analysis',
  'recording-error': 'surv.status.recordingError',
};
export const statusIsFault = (status: SurveillanceStatus): boolean =>
  ['camera-unavailable', 'storage-insufficient', 'analysis-unavailable', 'recording-error'].includes(status);

/**
 * The one colour each state is drawn in — status dot, viewfinder edge, camera
 * tab, stop button. A propped-up phone is read from across a room, where a
 * label is too small and a colour is not.
 */
export function statusColor(status: SurveillanceStatus): string {
  if (statusIsFault(status)) return color.warning;
  switch (status) {
    case 'recording': return color.recording;
    case 'active': return color.watching;
    case 'starting': return color.accent;
    default: return color.neutral400;
  }
}

/**
 * What the persistent notification says. With the screen off it is the only
 * surface, so a fault carries the time it began — "since when nobody has been
 * filmed" — and the first healthy status after a fault says when it ended,
 * until the next change replaces it.
 */
export function serviceNotice(status: SurveillanceStatus, faultSince: number | null, resumedAt: number | null): string {
  const label = t(STATUS_LABEL[status]);
  if (statusIsFault(status) && faultSince != null) return t('notif.since', { status: label, time: formatTimeOfDay(faultSince) });
  if (!statusIsFault(status) && resumedAt != null) return t('notif.resumed', { status: label, time: formatTimeOfDay(resumedAt) });
  return label;
}
