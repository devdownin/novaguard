/**
 * HTTPS is the owner's switch, the server is restarted with it, and Réglages
 * hands over what a client needs to trust the phone: the PEM, and a fingerprint
 * to compare on the other screen.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Text } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { SetupScreen } from '../src/screens/SetupScreen';
import { defaultSettings } from '../src/state/defaults';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const FINGERPRINT = Array.from({ length: 32 }, () => 'AB').join(':');
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const native = {
  startServer: jest.fn(async (port: number, _t: string, _c: string, _e: boolean, _x: number, tls: boolean) => ({
    running: true, port, ipAddress: null, url: `${tls ? 'https' : 'http'}://127.0.0.1:${port}/mcp`,
    hasToken: false, loopbackOnly: true, requestCount: 0, lastActivityAt: null, tls,
  })),
  stopServer: jest.fn(async () => true),
  getServerStatus: jest.fn(async () => ({ running: true, port: 8081, ipAddress: null, url: null, hasToken: false, loopbackOnly: true, requestCount: 0, lastActivityAt: null })),
  updateSnapshot: jest.fn(),
  getCaCertificate: jest.fn(async () => ({ pem: PEM, fingerprint: FINGERPRINT })),
};

let tree: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }
const texts = () => tree.root.findAllByType(Text).map(n => String(n.props.children));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (NativeModules as Record<string, unknown>).McpServer = native;
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings, mcpEnabled: true, exp: { ...defaultSettings.exp, mcp: true },
  }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><SetupScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
});
afterEach(async () => { await ReactTestRenderer.act(async () => { tree.unmount(); }); });

it('starts in plain HTTP and shows no certificate', () => {
  expect(native.startServer.mock.calls.at(-1)![5]).toBe(false);
  expect(texts()).not.toContain(FINGERPRINT);
});

it('restarts the server in HTTPS and shows what the client must trust', async () => {
  await ReactTestRenderer.act(async () => { state.toggleMcpTls(); });
  await ReactTestRenderer.act(async () => {});
  expect(native.startServer.mock.calls.at(-1)![5]).toBe(true);
  expect(texts()).toContain(FINGERPRINT);
  expect(texts()).toContain(t('setup.mcpTls.trust'));
  expect(tree.root.findAll(n => n.props.label === t('setup.mcpTls.copyPem') && typeof n.props.onPress === 'function').length).toBeGreaterThan(0);
  expect(texts().some(text => text.includes('https://127.0.0.1:8081/mcp'))).toBe(true);
});
