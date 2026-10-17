/**
 * "Connecter un assistant": the owner answers where and which, copies one thing, and the
 * screen says when the phone has actually seen the assistant.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, NativeModules, Text, TextInput } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { McpConnectSheet } from '../src/components/McpConnectSheet';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const TOKEN = 'mcp_' + 'r'.repeat(32);
let relayState: string;
let requests: number;
let grants: Array<Record<string, unknown>>;
let termux: boolean;
let selfTest: { ok: boolean; tools: number; ms: number };
const status = () => ({
  running: true, port: 8081, ipAddress: '192.168.1.42', url: 'http://192.168.1.42:8081/mcp', hasToken: true,
  loopbackOnly: false, requestCount: requests, lastActivityAt: requests ? 1_760_000_000_000 : null,
  relayState, relayUrl: relayState === 'connected' ? 'https://relay.test/d/abc/mcp' : null,
  pendingAuthorizations: [], grants: [...grants],
});
const native = {
  startServer: jest.fn(async () => status()),
  stopServer: jest.fn(async () => true),
  getServerStatus: jest.fn(async () => status()),
  startRelay: jest.fn(async () => { relayState = 'connected'; return status(); }),
  stopRelay: jest.fn(async () => { relayState = 'off'; return status(); }),
  revokeGrant: jest.fn(async (id: string) => { grants = grants.filter(g => g.id !== id); return true; }),
  selfTest: jest.fn(async () => selfTest),
  isTermuxInstalled: jest.fn(async () => termux),
  updateSnapshot: jest.fn(),
};

let tree: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }
const texts = () => tree.root.findAllByType(Text).map(n => String(n.props.children));
const press = async (label: string) => {
  const node = tree.root.find(n => typeof n.props.onPress === 'function'
    && (n.props.label === label || n.props.accessibilityLabel?.startsWith(label)));
  await ReactTestRenderer.act(async () => { node.props.onPress(); });
};
const payload = () => String(tree.root.findByProps({ testID: 'connect-payload' }).props.children);
const progressText = () => String(tree.root.findByProps({ testID: 'connect-progress' }).props.children);

async function mount(over: Partial<Settings> = {}) {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings, mcpEnabled: true, mcpToken: TOKEN, ...over,
  }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><McpConnectSheet /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => { state.openInfo('connect'); });
}

beforeEach(async () => {
  jest.clearAllMocks();
  relayState = 'off';
  requests = 0;
  grants = [];
  termux = false;
  selfTest = { ok: true, tools: 9, ms: 4 };
  await AsyncStorage.clear();
  (NativeModules as Record<string, unknown>).McpServer = native;
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
});
afterEach(async () => { if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); }); });

it('starts from the question and leads a LAN client to its own configuration', async () => {
  await mount();
  expect(texts()).toContain(t('connect.where.title'));
  await press(t('connect.where.lan'));
  await press('Claude Code');
  expect(payload()).toMatch(/^claude mcp add --transport http novaguard "http:\/\/192\.168\.1\.42:8081\/mcp"/);
  expect(payload()).toContain(TOKEN);
});

it('hands a local application the loopback address without the token', async () => {
  await mount();
  await press(t('connect.where.phone'));
  await press('Hermes Agent');
  expect(texts()).toContain(t('connect.phone.hint'));
  expect(payload()).toContain('http://127.0.0.1:8081/mcp');
  expect(payload()).not.toContain(TOKEN);
});

it('says what is in the way and clears it with the button beside it', async () => {
  await mount({ mcpToken: '' });
  await press(t('connect.where.lan'));
  await press('Claude Code');
  expect(texts()).toContain(t('connect.block.noToken'));
  await press(t('connect.fix.generateToken'));
  expect(state.settings.mcpToken).not.toBe('');
});

it('asks for the relay address, validates it, and asks consent before dialling out', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await mount();
  await press(t('connect.where.cloud'));
  await press('claude.ai');
  const input = () => tree.root.findByType(TextInput);

  await ReactTestRenderer.act(async () => { input().props.onChangeText('http://relay.test'); });
  await press(t('connect.fix.setRelay'));
  expect(texts()).toContain(t('connect.relay.invalid'));
  expect(state.settings.mcpRelayUrl).toBe('');

  await ReactTestRenderer.act(async () => { input().props.onChangeText('https://relay.test'); });
  await press(t('connect.fix.setRelay'));
  expect(state.settings.mcpRelayUrl).toBe('https://relay.test');

  expect(native.startRelay).not.toHaveBeenCalled();
  await press(t('connect.fix.enableCloud'));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(native.startRelay).not.toHaveBeenCalled();
  const accept = (alert.mock.calls[0][2] as Array<{ onPress?: () => void }>)[1];
  await ReactTestRenderer.act(async () => { accept.onPress!(); });
  await ReactTestRenderer.act(async () => {});
  expect(native.startRelay).toHaveBeenCalledWith('https://relay.test', false);
  alert.mockRestore();
});

it('shows the public address once the relay has accepted the phone, and says when the assistant calls', async () => {
  jest.useFakeTimers();
  try {
    await mount({ mcpRelayUrl: 'https://relay.test', mcpCloudEnabled: true });
    await press(t('connect.where.cloud'));
    await press('ChatGPT');
    expect(payload()).toBe('https://relay.test/d/abc/mcp');
    expect(progressText()).toBe(t('connect.progress.waiting'));

    requests = 3;
    await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(10_000); });
    await ReactTestRenderer.act(async () => {});
    expect(progressText()).not.toBe(t('connect.progress.waiting'));
    expect(progressText()).toContain(':');
  } finally {
    jest.useRealTimers();
  }
});

it('begins again at the question every time it is opened', async () => {
  await mount();
  await press(t('connect.where.lan'));
  await ReactTestRenderer.act(async () => { state.closeInfo(); });
  await ReactTestRenderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  await ReactTestRenderer.act(async () => { state.openInfo('connect'); });
  await ReactTestRenderer.act(async () => {});
  expect(texts()).toContain(t('connect.where.title'));
});

describe('access', () => {
  const CONTROL = 'mcp_' + 'k'.repeat(32);
  const radio = (label: string) => tree.root.find(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel?.startsWith(label));

  it('copies the read token by default and the control one only once chosen', async () => {
    await mount({ mcpControlEnabled: true, mcpControlToken: CONTROL, mcpControlExpiresAt: 0 });
    await press(t('connect.where.lan'));
    await press('Claude Code');
    expect(payload()).toContain(TOKEN);
    await press(t('connect.access.control'));
    expect(radio(t('connect.access.control')).props.accessibilityState.selected).toBe(true);
    expect(payload()).toContain(CONTROL);
    expect(payload()).not.toContain(TOKEN);
  });

  it('falls back to the read token if control is switched off after it was chosen', async () => {
    await mount({ mcpControlEnabled: true, mcpControlToken: CONTROL, mcpControlExpiresAt: 0 });
    await press(t('connect.where.lan'));
    await press('Claude Code');
    await press(t('connect.access.control'));
    expect(payload()).toContain(CONTROL);
    await ReactTestRenderer.act(async () => { state.toggleMcpControl(); });
    expect(payload()).toContain(TOKEN);
    expect(payload()).not.toContain(CONTROL);
  });

  it('cannot select control while it is off', async () => {
    await mount();
    await press(t('connect.where.lan'));
    await press('Claude Code');
    expect(radio(t('connect.access.control')).props.disabled).toBe(true);
    expect(texts()).toContain(t('connect.access.control.off'));
    expect(payload()).not.toContain(CONTROL);
  });

  it('says a cloud assistant only looks, and offers no choice', async () => {
    await mount({ mcpRelayUrl: 'https://relay.test', mcpCloudEnabled: true });
    await press(t('connect.where.cloud'));
    await press('claude.ai');
    expect(texts()).toContain(t('connect.access.cloud'));
    expect(tree.root.findAll(n => n.props.accessibilityRole === 'radio')).toHaveLength(0);
  });
});

describe('authorized assistants', () => {
  it('lists them on the first screen and revokes one', async () => {
    grants = [{ id: 'g1', clientName: 'Claude', host: 'claude.ai', createdAt: 1, lastUsedAt: 1_760_000_000_000 }];
    await mount();
    expect(texts()).toContain('Claude');
    await ReactTestRenderer.act(async () => {
      tree.root.find(n => n.props.accessibilityLabel === t('setup.mcpGrants.revoke.a11y', { client: 'Claude' }) && n.props.onPress).props.onPress();
    });
    expect(native.revokeGrant).toHaveBeenCalledWith('g1');
  });

  it('shows nothing when no assistant has been authorized', async () => {
    await mount();
    expect(tree.root.findAllByProps({ testID: 'connect-grants' })).toHaveLength(0);
  });
});

describe('shortcuts and proof', () => {
  it('offers to resume the last assistant, and reaches its screen in one tap', async () => {
    await AsyncStorage.setItem('@novaguard:connect:last:v1', JSON.stringify({ where: 'lan', agent: 'claude-code', access: 'read' }));
    await mount();
    await ReactTestRenderer.act(async () => {});
    await press(t('connect.resume', { agent: 'Claude Code', where: t('connect.where.lan') }));
    expect(payload()).toMatch(/^claude mcp add/);
  });

  it('remembers what it reached, and nothing before an assistant is chosen', async () => {
    await mount();
    await press(t('connect.where.lan'));
    expect(await AsyncStorage.getItem('@novaguard:connect:last:v1')).toBeNull();
    await press('Hermes Agent');
    expect(JSON.parse((await AsyncStorage.getItem('@novaguard:connect:last:v1'))!))
      .toEqual({ where: 'lan', agent: 'hermes', access: 'read' });
  });

  it('says so where Termux is installed', async () => {
    termux = true;
    await mount();
    await ReactTestRenderer.act(async () => {});
    expect(tree.root.find(n => n.props.accessibilityLabel?.includes(t('connect.where.phone.termux')))).toBeTruthy();
  });

  it('tests the server from the inside without calling it a connection', async () => {
    await mount();
    await press(t('connect.where.lan'));
    await press('Claude Code');
    await press(t('connect.test.run'));
    expect(String(tree.root.findByProps({ testID: 'connect-test' }).props.children))
      .toBe(t('connect.test.ok', { tools: 9, ms: 4 }));
    expect(progressText()).toBe(t('connect.progress.waiting'));
  });

  it('reports a server that does not answer', async () => {
    selfTest = { ok: false, tools: 0, ms: 0 };
    await mount();
    await press(t('connect.where.lan'));
    await press('Claude Code');
    await press(t('connect.test.run'));
    expect(String(tree.root.findByProps({ testID: 'connect-test' }).props.children)).toBe(t('connect.test.fail'));
  });

  it('offers a QR code of what is copied for another machine, and none for the same phone', async () => {
    await mount();
    await press(t('connect.where.lan'));
    await press('Claude Code');
    expect(tree.root.findAllByProps({ accessibilityLabel: t('setup.mcpQr.label') })).toHaveLength(0);
    await press(t('setup.mcpQr.show'));
    expect(tree.root.findAllByProps({ accessibilityLabel: t('setup.mcpQr.label') }).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { state.closeInfo(); });
    await ReactTestRenderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    await ReactTestRenderer.act(async () => { state.openInfo('connect'); });
    await press(t('connect.where.phone'));
    await press('Hermes Agent');
    expect(tree.root.findAll(n => n.props.label === t('setup.mcpQr.show') && n.props.onPress)).toHaveLength(0);
  });

  it('draws who talks to whom on the cloud path, with the relay named', async () => {
    await mount({ mcpRelayUrl: 'https://relay.test', mcpCloudEnabled: true });
    await press(t('connect.where.cloud'));
    await press('claude.ai');
    expect(tree.root.find(n => n.props.accessibilityLabel === `${t('connect.diagram.a11y', { host: 'relay.test' })} ${t('connect.diagram.note')}`)).toBeTruthy();
  });
});
