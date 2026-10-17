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
