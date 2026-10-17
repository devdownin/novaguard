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
import { Alert, AppState, NativeModules, Text } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { SetupScreen } from '../src/screens/SetupScreen';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const TOKEN = 'mcp_' + 'r'.repeat(32);
const { startForegroundService: startService } = jest.requireMock('../src/surveillance/foregroundService');
let relayState: string;
let pending: Array<Record<string, unknown>>;
let grants: Array<Record<string, unknown>>;
const status = (over: Record<string, unknown> = {}) => ({
  running: true, port: 8081, ipAddress: '192.168.1.42', url: 'http://192.168.1.42:8081/mcp', hasToken: true,
  loopbackOnly: false, requestCount: 0, lastActivityAt: null, relayState, relayUrl: null,
  // A new array on every read, like the native side builds one: that is what re-runs the prompt effect.
  pendingAuthorizations: [...pending], grants: [...grants], ...over,
});
const native = {
  startServer: jest.fn(async () => { relayState = 'off'; return status(); }),
  stopServer: jest.fn(async () => true),
  getServerStatus: jest.fn(async () => status()),
  startRelay: jest.fn(async () => { relayState = 'connecting'; return status(); }),
  stopRelay: jest.fn(async () => { relayState = 'off'; return status(); }),
  approveAuthorization: jest.fn(async (id: string) => { pending = pending.filter(p => p.id !== id); return true; }),
  denyAuthorization: jest.fn(async (id: string) => { pending = pending.filter(p => p.id !== id); return true; }),
  revokeGrant: jest.fn(async (id: string) => { grants = grants.filter(g => g.id !== id); return true; }),
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
    ...defaultSettings, mcpEnabled: true, mcpToken: TOKEN, mcpRelayUrl: 'https://relay.test',
    exp: { ...defaultSettings.exp, mcp: true }, ...over,
  }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><SetupScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  relayState = 'off';
  pending = [];
  grants = [];
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

  it('is never opened when no relay is configured', async () => {
    await mount({ mcpCloudEnabled: true, mcpRelayUrl: '' });
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

  it('is re-made towards the new relay when the address changes, and only for a valid one', async () => {
    await mount({ mcpCloudEnabled: true });
    expect(native.startRelay).toHaveBeenLastCalledWith('https://relay.test', false);
    await ReactTestRenderer.act(async () => { expect(state.setMcpRelayUrl('http://plain.example.org')).toBe(false); });
    expect(state.settings.mcpRelayUrl).toBe('https://relay.test');
    expect(native.startRelay).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { expect(state.setMcpRelayUrl(' https://Other.test/ ')).toBe(true); });
    await ReactTestRenderer.act(async () => {});
    expect(state.settings.mcpRelayUrl).toBe('https://other.test');
    expect(native.startRelay).toHaveBeenLastCalledWith('https://other.test', false);
  });

  it('is closed when the address is cleared', async () => {
    await mount({ mcpCloudEnabled: true });
    relayState = 'connected';
    await ReactTestRenderer.act(async () => { await native.getServerStatus(); });
    await ReactTestRenderer.act(async () => { state.setMcpRelayUrl(''); });
    await ReactTestRenderer.act(async () => {});
    expect(native.stopRelay).toHaveBeenCalled();
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
    ['no relay configured', { over: { mcpRelayUrl: '' } as Partial<Settings>, hint: 'setup.mcpCloud.noRelay' }],
    ['no access token', { over: { mcpToken: '' } as Partial<Settings>, hint: 'setup.mcpCloud.needsToken' }],
    ['the server off', { over: { mcpEnabled: false, exp: { ...defaultSettings.exp, mcp: true, adv: true } } as Partial<Settings>, hint: 'setup.mcpCloud.needsServer' }],
  ] as const)('cannot be turned on with %s, and says why', async (_name, c) => {
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

describe('an assistant waiting for the owner', () => {
  const waiting = { id: 'nvp_abc', clientName: 'Claude', host: 'claude.ai', code: '4821', expiresAt: Date.now() + 120_000 };
  /** The status poll is what brings a pending request to the app. */
  async function poll() {
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2_100); });
    await ReactTestRenderer.act(async () => {});
  }
  const alertSpy = () => jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const setAppState = (value: string) => Object.defineProperty(AppState, 'currentState', { value, configurable: true });

  beforeEach(() => { jest.useFakeTimers(); setAppState('active'); });
  afterEach(() => { jest.useRealTimers(); setAppState('active'); jest.restoreAllMocks(); });

  it('is asked, with the client, its address and the code to compare, and cannot be dismissed by accident', async () => {
    const alert = alertSpy();
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body, , options] = alert.mock.calls[0];
    expect(title).toBe(t('mcpAuth.title', { client: 'Claude' }));
    expect(body).toBe(t('mcpAuth.body', { client: 'Claude', host: 'claude.ai', code: '4821' }));
    expect(body).toContain('4821');
    expect(options).toMatchObject({ cancelable: false });
  });

  it('is asked once, however often the status is read', async () => {
    const alert = alertSpy();
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    await poll();
    await poll();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('is not asked again once answered, even while the phone still lists it', async () => {
    const alert = alertSpy();
    native.denyAuthorization.mockImplementationOnce(async () => true); // the list is not updated yet
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => { buttons.find(b => b.text === t('mcpAuth.deny'))!.onPress!(); });
    await poll();
    await poll();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('is allowed only by the owner pressing Autoriser', async () => {
    const alert = alertSpy();
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    expect(native.approveAuthorization).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => { buttons.find(b => b.text === t('mcpAuth.allow'))!.onPress!(); });
    expect(native.approveAuthorization).toHaveBeenCalledWith('nvp_abc');
    expect(native.denyAuthorization).not.toHaveBeenCalled();
  });

  it('is refused by Refuser', async () => {
    const alert = alertSpy();
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => { buttons.find(b => b.text === t('mcpAuth.deny'))!.onPress!(); });
    expect(native.denyAuthorization).toHaveBeenCalledWith('nvp_abc');
    expect(native.approveAuthorization).not.toHaveBeenCalled();
  });

  it('waits for the app to be on screen, and is then asked, not lost', async () => {
    const alert = alertSpy();
    setAppState('background');
    const listen = jest.spyOn(AppState, 'addEventListener');
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    expect(alert).not.toHaveBeenCalled();
    // The app comes back to the front: the prompt appears at once, without waiting for the next poll.
    // Several components listen to the app's state; the event reaches them all.
    const handlers = listen.mock.calls.filter(call => call[0] === 'change').map(call => call[1] as (state: string) => void);
    expect(handlers.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { handlers.forEach(handler => handler('active')); });
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('is asked when the state is not known to be hidden', async () => {
    const alert = alertSpy();
    setAppState('unknown');
    await mount({ mcpCloudEnabled: true });
    pending = [waiting];
    await poll();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('is never asked while cloud access is off', async () => {
    const alert = alertSpy();
    await mount();
    pending = [waiting];
    await poll();
    expect(alert).not.toHaveBeenCalled();
  });

  it('lists the assistants already authorized, and revokes one on request', async () => {
    grants = [{ id: 'nvg_1', clientName: 'Claude', host: 'claude.ai', createdAt: 1, lastUsedAt: Date.now() }];
    await mount({ mcpCloudEnabled: true });
    await poll();
    expect(texts()).toContain('Claude');
    const revoke = tree.root.find(n => n.props.accessibilityLabel === t('setup.mcpGrants.revoke.a11y', { client: 'Claude' }) && typeof n.props.onPress === 'function');
    await ReactTestRenderer.act(async () => { revoke.props.onPress(); });
    await ReactTestRenderer.act(async () => {});
    expect(native.revokeGrant).toHaveBeenCalledWith('nvg_1');
    await poll();
    expect(texts()).toContain(t('setup.mcpGrants.none'));
  });
});

describe('cutting cloud access from the notification', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const poll = async () => {
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2_100); });
    await ReactTestRenderer.act(async () => {});
  };
  const cloudLabel = () => startService.mock.calls.at(-1)[2];
  // The notification is the service's, which exists only while surveillance runs.
  const watch = () => ReactTestRenderer.act(async () => { state.toggleMonitoring(); });

  it('offers the action while the relay is connected, and not otherwise', async () => {
    await mount();
    await watch();
    expect(cloudLabel()).toBe('');
    await ReactTestRenderer.act(async () => { tree.unmount(); });

    relayState = 'connected';
    native.getServerStatus.mockImplementation(async () => status());
    await mount({ mcpCloudEnabled: true });
    await watch();
    await poll();
    expect(cloudLabel()).toBe(t('notif.cutCloud'));
    native.getServerStatus.mockImplementation(async () => status());
  });

  it('turns the switch off, acknowledges the cut and does not start the relay again', async () => {
    await mount({ mcpCloudEnabled: true });
    expect(native.startRelay).toHaveBeenCalledTimes(1);
    // The notification action ran natively: the relay is closed and the status says why.
    relayState = 'off';
    native.getServerStatus.mockImplementation(async () => status({ relayCut: true }));
    await poll();
    expect(state.settings.mcpCloudEnabled).toBe(false);
    expect(native.stopRelay).toHaveBeenCalled();
    expect(native.startRelay).toHaveBeenCalledTimes(1);
    native.getServerStatus.mockImplementation(async () => status());
  });

  it('does not start a relay while the cut is not acknowledged, even if the switch is still on', async () => {
    native.getServerStatus.mockImplementation(async () => status({ relayCut: true }));
    native.startServer.mockImplementation(async () => status({ relayCut: true }));
    await mount({ mcpCloudEnabled: true });
    await poll();
    expect(native.startRelay).not.toHaveBeenCalled();
    native.getServerStatus.mockImplementation(async () => status());
    native.startServer.mockImplementation(async () => { relayState = 'off'; return status(); });
  });
});
