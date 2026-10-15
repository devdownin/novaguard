import { serviceNotice, surveillanceStatusOf } from '../src/surveillance/status';

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

describe('serviceNotice', () => {
  const at = new Date(2026, 9, 14, 9, 5).getTime();
  it('dates a fault, says when it ended, and stays plain otherwise', () => {
    expect(serviceNotice('storage-insufficient', at, null)).toBe('Stockage insuffisant · depuis 09:05');
    expect(serviceNotice('active', null, at)).toBe('Surveillance active · reprise à 09:05');
    expect(serviceNotice('recording', null, null)).toBe('Enregistrement en cours');
  });
  it('never dates a healthy status with a fault time, nor a fault with a recovery', () => {
    expect(serviceNotice('active', at, null)).toBe('Surveillance active');
    expect(serviceNotice('camera-unavailable', null, at)).toBe('Caméra indisponible');
  });
});

describe('statusColor', () => {
  it('gives each family of states its own colour', () => {
    const { color } = require('../src/theme');
    const { statusColor } = require('../src/surveillance/status');
    expect(statusColor('active')).toBe(color.watching);
    expect(statusColor('recording')).toBe(color.recording);
    expect(statusColor('inactive')).toBe(color.neutral400);
    expect(statusColor('starting')).toBe(color.accent);
    for (const fault of ['camera-unavailable', 'storage-insufficient', 'analysis-unavailable', 'recording-error']) {
      expect(statusColor(fault)).toBe(color.warning);
    }
    // A fault must never read as "filming" or "all well", whatever else is true.
    expect(new Set([color.watching, color.recording, color.warning, color.neutral400]).size).toBe(4);
  });
});
