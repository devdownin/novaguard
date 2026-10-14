import { surveillanceStatusOf } from '../src/surveillance/status';

const healthy = {
  monitoring: true, recording: false, cameraPermission: true, cameraHealth: 'healthy' as const,
  analysisProblem: null, recordingProblem: null, otherProblem: null,
  lowStorage: false, hasFrame: true, ready: true,
};

it('distinguishes standby, warming up, monitoring and recording', () => {
  expect(surveillanceStatusOf({ ...healthy, monitoring: false })).toBe('inactive');
  expect(surveillanceStatusOf({ ...healthy, hasFrame: false })).toBe('starting');
  expect(surveillanceStatusOf({ ...healthy, ready: false })).toBe('starting');
  expect(surveillanceStatusOf(healthy)).toBe('active');
  expect(surveillanceStatusOf({ ...healthy, recording: true })).toBe('recording');
});
it('gives faults priority over an encoder that is still active', () => {
  expect(surveillanceStatusOf({ ...healthy, recording: true, cameraHealth: 'interrupted' })).toBe('camera-unavailable');
  expect(surveillanceStatusOf({ ...healthy, cameraPermission: false })).toBe('camera-unavailable');
  expect(surveillanceStatusOf({ ...healthy, recording: true, analysisProblem: 'model failed' })).toBe('analysis-unavailable');
  expect(surveillanceStatusOf({ ...healthy, recording: true, lowStorage: true })).toBe('storage-insufficient');
  expect(surveillanceStatusOf({ ...healthy, recordingProblem: 'Error: Espace insuffisant pour enregistrer' })).toBe('storage-insufficient');
  expect(surveillanceStatusOf({ ...healthy, recordingProblem: 'capture/file-io-error: ENOSPC' })).toBe('storage-insufficient');
  expect(surveillanceStatusOf({ ...healthy, recordingProblem: 'encoder failed' })).toBe('recording-error');
  expect(surveillanceStatusOf({ ...healthy, otherProblem: 'service refused' })).toBe('recording-error');
});
it('does not label deliberate standby as a failed watch', () => {
  expect(surveillanceStatusOf({ ...healthy, monitoring: false, recordingProblem: 'old error', lowStorage: true })).toBe('inactive');
});
