/**
 * The wrapper has to survive the native module being absent — that is its whole
 * point. A build where codegen has not run, or any non-Android host, gets null
 * from TurboModuleRegistry.get, and failing to promote the process must not be
 * able to take the app down.
 */

import { PermissionsAndroid } from 'react-native';

// `mock`-prefixed so Jest allows the factory below to close over them.
const mockNative = {
  start: jest.fn(),
  stop: jest.fn(),
  isRunning: jest.fn(() => false),
  notifyDetection: jest.fn(),
  dismissDetection: jest.fn(),
  openDetectionChannelSettings: jest.fn(),
};

jest.mock('../src/specs/NativeSurveillanceService', () => ({
  __esModule: true,
  get default() { return mockModuleValue; },
}));

let mockModuleValue: typeof mockNative | null = mockNative;

function load() {
  let api!: typeof import('../src/surveillance/foregroundService');
  jest.isolateModules(() => { api = require('../src/surveillance/foregroundService'); });
  return api;
}

beforeEach(() => {
  mockModuleValue = mockNative;
  jest.clearAllMocks();
});

describe('with the native module present', () => {
  it('starts the service with the notification copy', () => {
    const api = load();
    expect(api.startForegroundService()).toBe(true);
    expect(mockNative.start).toHaveBeenCalledWith(api.NOTIFICATION_TITLE, api.NOTIFICATION_BODY);
  });

  it('stops the service', () => {
    load().stopForegroundService();
    expect(mockNative.stop).toHaveBeenCalled();
  });

  it('reports the running state from the service', () => {
    mockNative.isRunning.mockReturnValue(true);
    expect(load().isForegroundServiceRunning()).toBe(true);
  });

  it('reports failure instead of throwing when the native call blows up', () => {
    mockNative.start.mockImplementation(() => { throw new Error('SecurityException'); });
    expect(load().startForegroundService()).toBe(false);
  });

  it('swallows a failing stop — the process may already be tearing down', () => {
    mockNative.stop.mockImplementation(() => { throw new Error('dead'); });
    expect(() => load().stopForegroundService()).not.toThrow();
  });

  it('posts and clears the detection alert', () => {
    const api = load();
    api.notifyDetection('Personne détectée', 'À 14:32 · enregistrement en cours');
    expect(mockNative.notifyDetection).toHaveBeenCalledWith(
      'Personne détectée', 'À 14:32 · enregistrement en cours',
    );
    api.dismissDetectionAlert();
    expect(mockNative.dismissDetection).toHaveBeenCalled();
  });

  it('opens the system channel settings for sound and vibration', () => {
    load().openDetectionChannelSettings();
    expect(mockNative.openDetectionChannelSettings).toHaveBeenCalled();
  });

  it('never lets a failing alert interrupt surveillance', () => {
    mockNative.notifyDetection.mockImplementation(() => { throw new Error('no channel'); });
    expect(() => load().notifyDetection('x', 'y')).not.toThrow();
  });
});

describe('with the native module missing', () => {
  beforeEach(() => { mockModuleValue = null; });

  it('degrades to a no-op rather than throwing', () => {
    const api = load();
    expect(api.startForegroundService()).toBe(false);
    expect(() => api.stopForegroundService()).not.toThrow();
    expect(api.isForegroundServiceRunning()).toBe(false);
    expect(() => api.notifyDetection('x', 'y')).not.toThrow();
    expect(() => api.dismissDetectionAlert()).not.toThrow();
    expect(() => api.openDetectionChannelSettings()).not.toThrow();
    expect(mockNative.start).not.toHaveBeenCalled();
    expect(mockNative.notifyDetection).not.toHaveBeenCalled();
  });
});

describe('notification permission', () => {
  it('is granted when the OS says so', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
      PermissionsAndroid.RESULTS.GRANTED,
    );
    await expect(load().requestNotificationPermission()).resolves.toBe('granted');
  });

  it('is not granted when the user refuses', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
      PermissionsAndroid.RESULTS.DENIED,
    );
    await expect(load().requestNotificationPermission()).resolves.toBe('denied');
  });

  /**
   * The case a boolean hid. Android shows no dialog once this is the answer, so
   * the request resolves having displayed nothing: a caller that read it as an
   * ordinary refusal could only offer a button that appears to do nothing.
   */
  it('says so when Android will not ask again, rather than calling it a refusal', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
      PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
    );
    await expect(load().requestNotificationPermission()).resolves.toBe('blocked');
  });

  it('treats a thrown request as refused', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockRejectedValue(new Error('no such permission'));
    // 'denied', not 'blocked': a throw says nothing about whether Android would
    // have asked, and sending the user to settings on a guess is worse.
    await expect(load().requestNotificationPermission()).resolves.toBe('denied');
  });

  it('checks the current grant without prompting', async () => {
    const check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    await expect(load().hasNotificationPermission()).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  });
});
