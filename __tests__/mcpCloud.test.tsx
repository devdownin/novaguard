/**
 * Cloud access is the one switch that makes the app dial out. It must do nothing
 * until the owner has said yes with the relay named, never run without a read
 * token, follow the server when it restarts, and stop when switched off.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, NativeModules, Text } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { SetupScreen } from '../src/screens/SetupScreen';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

// Read on every access, so each test can decide whether this build has a relay. Babel
// flattens a getter written in an object literal into its first value, hence defineProperty.
const relayUrl = (value: string) => { (globalThis as Record<string, unknown>).mockRelayUrl = value; };
jest.mock('../src/constants/app', () => {
  const mocked = { ...jest.requireActual('../src/constants/app') };
  Object.defineProperty(mocked, 'RELAY_URL', {
    enumerable: true, get: () => (globalThis as Record<string, unknown>).mockRelayUrl,
  });
  return mocked;
});

const TOKEN = 'mcp_' + 'r'.repeat(32);
let relayState: string;
const status = (over: Record<string, unknown> = {}) => ({
  running: true, port: 8081, ipAddress: '192.168.1.42', url: 'http://192.168.1.42:8081/mcp', hasToken: true,
  loopbackOnly: false, requestCount: 0, lastActivityAt: null, relayState, relayUrl: null, ...over,
});
const native = {
  startServer: jest.fn(async () => { relayState = 'off'; return status(); }),
  stopServer: jest.fn(async () => true),
  getServerStatus: jest.fn(async () => status()),
  startRelay: jest.fn(async () => { relayState = 'connecting'; return status(); }),
  stopRelay: jest.fn(async () => { relayState = 'off'; return status(); }),
  updateSnapshot: jest.fn(),
};

let tree: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }
const texts = () => tree.root.findAllByType(Text).map(n => String(n.props.children));
const cloudSwitch = () => tree.root.find(n => n.props.accessibilityRole === 'switch' && n.props.accessibilityLabel === t('setup.mcpCloud'));
// The component the screen renders, whose `onValueChange` is what a tap ends up calling.
const toggleCloud = (value: boolean) => tree.root
  .find(n => typeof n.props.onValueChange === 'function' && n.props.accessibilityLabel === t('setup.mcpCloud'))
  .props.onValueChange(value);

async function mount(over: Partial<Settings> = {}) {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings, mcpEnabled: true, mcpToken: TOKEN, exp: { ...defaultSettings.exp, mcp: true }, ...over,
  }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><SetupScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  relayUrl('https://relay.test');
  relayState = 'off';
  await AsyncStorage.clear();
  (NativeModules as Record<string, unknown>).McpServer = native;
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
});
afterEach(async () => { if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); }); });

describe('the connection', () => {
  it('is never opened while the switch is off', async () => {
    await mount();
    expect(native.startServer).toHaveBeenCalled();
    expect(native.startRelay).not.toHaveBeenCalled();
  });

  it('is opened to the relay once the switch is on', async () => {
    await mount({ mcpCloudEnabled: true });
    expect(native.startRelay).toHaveBeenCalledTimes(1);
    expect(native.startRelay).toHaveBeenCalledWith('https://relay.test', false);
  });

  it('is never opened without a read token', async () => {
    await mount({ mcpCloudEnabled: true, mcpToken: '' });
    expect(native.startRelay).not.toHaveBeenCalled();
  });

  it('is never opened when this build has no relay', async () => {
    relayUrl('');
    await mount({ mcpCloudEnabled: true });
    expect(native.startRelay).not.toHaveBeenCalled();
  });

  it('is never opened while the MCP server is off', async () => {
    await mount({ mcpCloudEnabled: true, mcpEnabled: false });
    expect(native.startRelay).not.toHaveBeenCalled();
  });

  it('is closed when the switch goes off', async () => {
    await mount({ mcpCloudEnabled: true });
    relayState = 'connected';
    await ReactTestRenderer.act(async () => { await native.getServerStatus(); });
    await ReactTestRenderer.act(async () => { state.toggleMcpCloud(); });
    await ReactTestRenderer.act(async () => {});
    expect(native.stopRelay).toHaveBeenCalled();
  });

  it('comes back by itself when a server restart took it down', async () => {
    jest.useFakeTimers();
    try {
      await mount({ mcpCloudEnabled: true });
      expect(native.startRelay).toHaveBeenCalledTimes(1);
      // The restart wiped it natively; the next status poll says so.
      relayState = 'off';
      await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2_100); });
      await ReactTestRenderer.act(async () => {});
      expect(native.startRelay).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('carries the live view only when both owner switches allow it', async () => {
    await mount({ mcpCloudEnabled: true, mcpCloudLiveFrame: true, mcpLiveFrameEnabled: false });
    expect(native.startRelay).toHaveBeenLastCalledWith('https://relay.test', false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });

    jest.clearAllMocks();
    relayState = 'off';
    await mount({ mcpCloudEnabled: true, mcpCloudLiveFrame: true, mcpLiveFrameEnabled: true });
    expect(native.startRelay).toHaveBeenLastCalledWith('https://relay.test', true);
  });
});

describe('the switch', () => {
  it('asks first, naming the relay and what it sees', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount();
    await ReactTestRenderer.act(async () => { toggleCloud(true); });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toBe(t('setup.mcpCloud.consent.body', { host: 'relay.test' }));
    expect(alert.mock.calls[0][1]).toContain('relay.test');
    expect(state.settings.mcpCloudEnabled).toBe(false);
    expect(native.startRelay).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('turns on only when the owner accepts', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount();
    await ReactTestRenderer.act(async () => { toggleCloud(true); });
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => { buttons.find(b => b.text === t('setup.mcpCloud.consent.accept'))!.onPress!(); });
    await ReactTestRenderer.act(async () => {});
    expect(state.settings.mcpCloudEnabled).toBe(true);
    expect(native.startRelay).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('turns off without asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await mount({ mcpCloudEnabled: true });
    await ReactTestRenderer.act(async () => { toggleCloud(false); });
    expect(alert).not.toHaveBeenCalled();
    expect(state.settings.mcpCloudEnabled).toBe(false);
    alert.mockRestore();
  });

  it.each([
    ['no relay in the build', { mockRelay: '', over: {} as Partial<Settings>, hint: 'setup.mcpCloud.noRelay' }],
    ['no access token', { mockRelay: 'https://relay.test', over: { mcpToken: '' } as Partial<Settings>, hint: 'setup.mcpCloud.needsToken' }],
    ['the server off', { mockRelay: 'https://relay.test', over: { mcpEnabled: false, exp: { ...defaultSettings.exp, mcp: true, adv: true } } as Partial<Settings>, hint: 'setup.mcpCloud.needsServer' }],
  ] as const)('cannot be turned on with %s, and says why', async (_name, c) => {
    relayUrl(c.mockRelay);
    await mount(c.over);
    expect(cloudSwitch().props.accessibilityState).toMatchObject({ disabled: true });
    expect(texts()).toContain(t(c.hint));
  });

  it('shows the state, the address to give the cloud, and that it only reads', async () => {
    native.getServerStatus.mockImplementation(async () => status({ relayState: 'connected', relayUrl: 'https://relay.test/d/abc/mcp' }));
    jest.useFakeTimers();
    try {
      await mount({ mcpCloudEnabled: true });
      await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2_100); });
      await ReactTestRenderer.act(async () => {});
      expect(texts()).toContain(t('setup.mcpCloud.state.connected'));
      expect(texts()).toContain(t('setup.mcpCloud.readOnly'));
      expect(tree.root.findAll(n => n.props.label === t('setup.mcpCloud.copyUrl') && typeof n.props.onPress === 'function').length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
      native.getServerStatus.mockImplementation(async () => status());
    }
  });
});
