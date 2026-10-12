import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Text } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { AppStateProvider, mergeStoredSettings, useAppState } from '../src/state/AppStateContext';
import { SetupScreen } from '../src/screens/SetupScreen';
import { SurveillanceScreen } from '../src/screens/SurveillanceScreen';
import { defaultSettings } from '../src/state/defaults';
import { t } from '../src/i18n';
import { startForegroundService } from '../src/surveillance/foregroundService';

jest.mock('../src/surveillance/foregroundService');
jest.mock('../src/components/CameraFeed', () => ({ CameraFeed: () => null }));
const native = {
  startCapture: jest.fn(async () => {}), stopCapture: jest.fn(async () => {}),
  addListener: jest.fn(), removeListeners: jest.fn(),
};
let tree: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }
async function mount() {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({ ...defaultSettings, exp: { ...defaultSettings.exp, rec: true } }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><SetupScreen /><SurveillanceScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
}
function button(label: string) {
  return tree.root.findAll(node => node.props.onPress && node.props.accessibilityRole === 'button')
    .find(node => node.findAll(child => child.type === Text && child.props.children === label).length > 0)!;
}
function labels() {
  return tree.root.findAll(node => node.type === Text).map(node => node.props.children);
}
function statusOnScreen() {
  return tree.root.findByProps({ testID: 'surveillance-status' }).props.accessibilityLabel;
}

beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks(); await AsyncStorage.clear();
  NativeModules.PresenceRecorder = native;
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  (fs.getFSInfo as jest.Mock).mockResolvedValue({ freeSpace: 8e10, totalSpace: 1e11 });
});
afterEach(async () => {
  if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); });
  jest.useRealTimers();
});
it('offers two explicit modes and shows a tolerance control only when it applies', async () => {
  await mount();
  expect(button(t('setup.mode.strict')).props.accessibilityState.selected).toBe(true);
  expect(labels()).not.toContain(t('setup.post'));
  await ReactTestRenderer.act(async () => { button(t('setup.mode.tolerant')).props.onPress(); });
  expect(button(t('setup.mode.tolerant')).props.accessibilityState.selected).toBe(true);
  expect(labels()).toContain(t('setup.post'));
  expect(state.settings.post).toBe('1 s');
});
it('preserves old saved tails and derives the tolerant mode without resetting them', () => {
  expect(mergeStoredSettings({ post: '30 s' })).toMatchObject({ post: '30 s', tolerance: '30 s' });
  expect(mergeStoredSettings({ post: '0 s' })).toMatchObject({ post: '0 s', tolerance: '1 s' });
});
it('says detection is unavailable on both camera surfaces and the background notification', async () => {
  await mount();
  await ReactTestRenderer.act(async () => { state.toggleMonitoring(); });
  expect(statusOnScreen()).toBe(t('surv.status.starting'));
  await ReactTestRenderer.act(async () => { state.reportCameraProblem('Modèle indisponible'); });
  expect(statusOnScreen()).toBe(t('surv.status.analysis'));
  expect(tree.root.findByProps({ testID: 'viewfinder-status' }).props.accessibilityLabel).toBe(t('surv.status.analysis'));
  expect(startForegroundService).toHaveBeenLastCalledWith(t('surv.status.analysis'));
  expect(labels()).not.toContain(t('view.overlay.none'));
  await ReactTestRenderer.act(async () => { state.reportCameraProblem(null); state.reportDetections([], 9 / 16); });
  expect(statusOnScreen()).toBe(t('surv.status.on'));
});
it('shows insufficient storage even before a subject triggers a recording', async () => {
  (fs.getFSInfo as jest.Mock).mockResolvedValue({ freeSpace: 0, totalSpace: 1e11 });
  await mount();
  await ReactTestRenderer.act(async () => { state.toggleMonitoring(); });
  expect(statusOnScreen()).toBe(t('surv.status.storage'));
  expect(startForegroundService).toHaveBeenLastCalledWith(t('surv.status.storage'));
});
