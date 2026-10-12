import { CameraHealth } from '../camera/cameraHealth';
import { StringKey } from '../i18n/fr';

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
