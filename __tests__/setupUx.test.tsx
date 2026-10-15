import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Text } from 'react-native';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { SetupScreen } from '../src/screens/SetupScreen';
import { defaultSettings } from '../src/state/defaults';
import { t } from '../src/i18n';
import { Settings } from '../src/state/types';

jest.mock('../src/surveillance/foregroundService');
let tree: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }
async function mount(stored: Partial<Settings> = {}) {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings, exp: { ...defaultSettings.exp, surv: true }, ...stored,
  }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><SetupScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
}
const texts = () => tree.root.findAll(node => node.type === Text).map(node => node.props.children);
const switchFor = (label: string) => tree.root.find(node => node.props.accessibilityRole === 'switch' &&
  node.props.accessibilityLabel === label);

beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  NativeModules.PresenceRecorder = { startCapture: jest.fn(async () => {}), stopCapture: jest.fn(async () => {}),
    addListener: jest.fn(), removeListeners: jest.fn() };
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  (fs.getFSInfo as jest.Mock).mockResolvedValue({ freeSpace: 8e10, totalSpace: 1e11 });
});
afterEach(async () => {
  if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); });
  (useCameraDevice as jest.Mock).mockReturnValue(undefined);
});

describe('night mode', () => {
  it('cannot be switched on, nor read as on, when the camera has no low-light boost', async () => {
    (useCameraDevice as jest.Mock).mockReturnValue({ supportsLowLightBoost: false });
    await mount({ night: true });
    expect(texts()).toContain(t('setup.night.unsupported'));
    expect(switchFor(t('setup.night')).props.accessibilityState).toMatchObject({ checked: false, disabled: true });
  });
  it('is an ordinary switch when the camera supports it', async () => {
    (useCameraDevice as jest.Mock).mockReturnValue({ supportsLowLightBoost: true });
    await mount({ night: true });
    expect(texts()).toContain(t('setup.night.sub'));
    expect(switchFor(t('setup.night')).props.accessibilityState).toMatchObject({ checked: true, disabled: false });
    expect(state.settings.night).toBe(true);
  });
});
