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
import { formatWhen } from '../src/utils/date';
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

describe('MCP client setup', () => {
  const controlToken = 'mcp_' + 'k'.repeat(32);
  const mcp = (over: Partial<Settings>) => mount({
    mcpEnabled: true, mcpControlEnabled: true, mcpControlToken: controlToken,
    exp: { ...defaultSettings.exp, mcp: true }, ...over,
  });
  const qrValue = async () => {
    const button = tree.root.find(node => node.props.label === t('setup.mcpQr.show') && node.props.onPress);
    await ReactTestRenderer.act(async () => { button.props.onPress(); });
    return JSON.parse(tree.root.findByProps({ testID: 'mcp-qr' }).parent!.props.value);
  };

  it('puts the control token in the QR code while it lives', async () => {
    const expiresAt = Date.now() + 3_600_000;
    await mcp({ mcpControlExpiresAt: expiresAt });
    expect(texts()).toContain(t('setup.mcpControlToken.expires', { time: formatWhen(expiresAt) }));
    const config = await qrValue();
    expect(config.mcpServers.novaguard.headers.Authorization).toBe(`Bearer ${controlToken}`);
    expect(texts()).toContain(t('setup.mcpQr.hint'));
  });

  it('says an expired token is expired, and stops handing it out', async () => {
    await mcp({ mcpControlExpiresAt: Date.now() - 1, mcpToken: 'mcp_' + 'r'.repeat(32) });
    expect(texts()).toContain(t('setup.mcpControlToken.expired'));
    expect(texts()).toContain(t('setup.mcpMode.readOnly'));
    const config = await qrValue();
    expect(config.mcpServers.novaguard.headers.Authorization).toBe(`Bearer mcp_${'r'.repeat(32)}`);
  });

  it('shows a token without expiry as such', async () => {
    await mcp({ mcpControlExpiresAt: 0 });
    expect(texts()).toContain(t('setup.mcpControlToken.forever'));
  });
});
