/**
 * What the viewfinder says before the preview covers it. It claimed "no camera
 * detected" on every launch, for the second the session takes to deliver, and
 * whenever the device list arrived a render late.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { Viewfinder } from '../src/components/Viewfinder';
import { NO_DEVICE_GRACE_MS, standbyLabelKey } from '../src/camera/deviceSelection';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

describe('standbyLabelKey', () => {
  const base = { cameraPermission: true, monitoring: true, deviceFound: false, graceOver: false };
  it('says the camera is starting until there is reason to believe there is none', () => {
    expect(standbyLabelKey(base)).toBe('view.cameraStarting');
    expect(standbyLabelKey({ ...base, deviceFound: true, graceOver: true })).toBe('view.cameraStarting');
    expect(standbyLabelKey({ ...base, graceOver: true })).toBe('view.noCamera');
  });
  it('asks for the permission first, and rests when not monitoring', () => {
    expect(standbyLabelKey({ ...base, cameraPermission: false, graceOver: true })).toBe('view.grantCamera');
    expect(standbyLabelKey({ ...base, monitoring: false, graceOver: true })).toBe('view.standby');
  });
});

describe('the viewfinder', () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  let state: ReturnType<typeof useAppState>;
  function Probe() { state = useAppState(); return null; }
  const texts = () => tree.root.findAllByType(Text).map(n => String(n.props.children));

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  });
  afterEach(async () => {
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    (useCameraDevice as jest.Mock).mockReturnValue(undefined);
    jest.useRealTimers();
  });

  async function startMonitoring() {
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppStateProvider><Viewfinder /><Probe /></AppStateProvider>);
    });
    await ReactTestRenderer.act(async () => {});
    await ReactTestRenderer.act(async () => { state.toggleMonitoring(); });
  }

  it('says the camera is starting, not that there is none, when a device exists', async () => {
    (useCameraDevice as jest.Mock).mockReturnValue({ id: 'back', position: 'back', neutralZoom: 1 });
    await startMonitoring();
    expect(texts()).toContain(t('view.cameraStarting'));
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(NO_DEVICE_GRACE_MS + 100); });
    expect(texts()).not.toContain(t('view.noCamera'));
  });

  it('says there is no camera only once the grace is over with no device found', async () => {
    (useCameraDevice as jest.Mock).mockReturnValue(undefined);
    await startMonitoring();
    expect(texts()).not.toContain(t('view.noCamera'));
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(NO_DEVICE_GRACE_MS + 100); });
    expect(texts()).toContain(t('view.noCamera'));
  });
});
