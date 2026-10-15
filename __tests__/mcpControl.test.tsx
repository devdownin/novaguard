/**
 * Control calls reach the app's own callbacks, and only while the device allows it.
 *
 * @format
 */
import { NativeModules } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import { mountProvider } from '../testing/mountProvider';
import { AGENT_LOG_KEY } from '../src/surveillance/agentLog';
import type { McpCommandRequest } from '../src/surveillance/mcpServer';

jest.mock('../src/surveillance/foregroundService');

const mockHandlers: Array<(request: McpCommandRequest) => void> = [];
const mockUnsubscribe = jest.fn();
const mockRevoked: Array<() => void> = [];
jest.mock('../src/surveillance/mcpServer', () => {
  const actual = jest.requireActual('../src/surveillance/mcpServer');
  return {
    ...actual,
    onMcpCommand: jest.fn((handler: (request: McpCommandRequest) => void) => { mockHandlers.push(handler); return mockUnsubscribe; }),
    resolveMcpCommand: jest.fn(),
    onMcpControlRevoked: jest.fn((handler: () => void) => { mockRevoked.push(handler); return () => {}; }),
  };
});
const { resolveMcpCommand } = jest.requireMock('../src/surveillance/mcpServer');

const native = {
  startServer: jest.fn(async (port: number) => ({
    running: true, port, ipAddress: null, url: `http://127.0.0.1:${port}/mcp`,
    hasToken: false, loopbackOnly: true, requestCount: 0, lastActivityAt: null,
  })),
  stopServer: jest.fn(async () => true),
  getServerStatus: jest.fn(async () => ({ running: true, port: 8081, ipAddress: null, url: null, hasToken: false, loopbackOnly: true, requestCount: 0, lastActivityAt: null })),
  updateSnapshot: jest.fn(),
  generateToken: jest.fn(async () => 'mcp_' + 'c'.repeat(32)),
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockHandlers.length = 0;
  mockRevoked.length = 0;
  await AsyncStorage.clear();
  (NativeModules as Record<string, unknown>).McpServer = native;
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
});
afterEach(() => jest.useRealTimers());

const send = async (command: string, args: object = {}) => {
  await ReactTestRenderer.act(async () => {
    mockHandlers.at(-1)!({ id: `c-${command}`, command, args: JSON.stringify(args) });
  });
  return JSON.parse(resolveMcpCommand.mock.calls.at(-1)[1]);
};

it('listens for control calls only while the device allows control', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  expect(mockHandlers).toHaveLength(0);

  await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
  await ReactTestRenderer.act(async () => { handle.state.generateMcpControlToken(); });
  await ReactTestRenderer.act(async () => {});
  expect(mockHandlers.length).toBeGreaterThan(0);
  expect(native.startServer).toHaveBeenLastCalledWith(8081, '', 'mcp_' + 'c'.repeat(32), true, expect.any(Number));

  await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
  expect(mockUnsubscribe).toHaveBeenCalled();
  expect(native.startServer).toHaveBeenLastCalledWith(8081, '', 'mcp_' + 'c'.repeat(32), false, expect.any(Number));
});

it('carries a call out with the screens’ own callbacks, answers it, and logs it', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });

  expect(await send('set_sensitivity', { sensitivity: 'Haute' })).toMatchObject({ ok: true, changed: true });
  expect(handle.state.settings.sens).toBe('Haute');
  expect(resolveMcpCommand).toHaveBeenLastCalledWith('c-set_sensitivity', expect.any(String));

  expect(await send('start_surveillance')).toMatchObject({ ok: true, changed: true });
  expect(handle.state.monitoring).toBe(true);
  expect(await send('stop_surveillance')).toMatchObject({ ok: true, changed: true });
  expect(handle.state.monitoring).toBe(false);

  expect(await send('delete_event', { eventId: 1 })).toMatchObject({ ok: false });

  expect(handle.state.agentLog.map(a => [a.command, a.ok])).toEqual([
    ['delete_event', false], ['stop_surveillance', true], ['start_surveillance', true], ['set_sensitivity', true],
  ]);
  expect(JSON.parse((await AsyncStorage.getItem(AGENT_LOG_KEY))!)).toHaveLength(4);
});

describe('control token lifetime', () => {
  const HOUR = 3_600_000;

  it('expires a day after it is issued by default, and the server is told when', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
    await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
    const issuedAt = Date.now();
    await ReactTestRenderer.act(async () => { handle.state.generateMcpControlToken(); });
    await ReactTestRenderer.act(async () => {});
    expect(handle.state.settings.mcpControlTtl).toBe('24 h');
    expect(handle.state.settings.mcpControlExpiresAt).toBe(issuedAt + 24 * HOUR);
    expect(native.startServer).toHaveBeenLastCalledWith(8081, '', 'mcp_' + 'c'.repeat(32), true, issuedAt + 24 * HOUR);
  });

  it('counts a new lifetime from now, and "Toujours" means no end', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
    await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
    await ReactTestRenderer.act(async () => { handle.state.generateMcpControlToken(); });
    await ReactTestRenderer.act(async () => {});

    await ReactTestRenderer.act(async () => { handle.state.cycleMcpControlTtl(); });
    expect(handle.state.settings.mcpControlTtl).toBe('Toujours');
    expect(handle.state.settings.mcpControlExpiresAt).toBe(0);

    jest.setSystemTime(Date.now() + 5 * HOUR);
    const now = Date.now();
    await ReactTestRenderer.act(async () => { handle.state.cycleMcpControlTtl(); });
    expect(handle.state.settings.mcpControlTtl).toBe('1 h');
    expect(handle.state.settings.mcpControlExpiresAt).toBe(now + HOUR);
  });

  it('changes no expiry while there is no token, and clearing the token clears it', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.cycleMcpControlTtl(); });
    expect(handle.state.settings.mcpControlExpiresAt).toBe(0);

    await ReactTestRenderer.act(async () => { handle.state.generateMcpControlToken(); });
    await ReactTestRenderer.act(async () => {});
    expect(handle.state.settings.mcpControlExpiresAt).toBe(0);
    await ReactTestRenderer.act(async () => { handle.state.cycleMcpControlTtl(); });
    expect(handle.state.settings.mcpControlExpiresAt).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { handle.state.clearMcpControlToken(); });
    expect(handle.state.settings.mcpControlExpiresAt).toBe(0);
  });
});

it('turns control off when it is cut from the notification', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
  expect(mockRevoked.length).toBeGreaterThan(0);

  await ReactTestRenderer.act(async () => { mockRevoked.at(-1)!(); });
  expect(handle.state.settings.mcpControlEnabled).toBe(false);
  expect((native.startServer.mock.calls.at(-1) as unknown[])[3]).toBe(false);
});

it('offers "Couper le pilotage" on the notification only while an agent may drive the camera', async () => {
  const { startForegroundService } = jest.requireMock('../src/surveillance/foregroundService');
  const { t } = jest.requireActual('../src/i18n');
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
  await ReactTestRenderer.act(async () => {});
  expect(startForegroundService.mock.calls.at(-1)[1]).toBe('');

  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
  await ReactTestRenderer.act(async () => {});
  // The switch alone is not control: without a token no agent can drive anything.
  expect(startForegroundService.mock.calls.at(-1)[1]).toBe('');

  await ReactTestRenderer.act(async () => { handle.state.generateMcpControlToken(); });
  await ReactTestRenderer.act(async () => {});
  expect(startForegroundService.mock.calls.at(-1)[1]).toBe(t('notif.revokeControl'));

  await ReactTestRenderer.act(async () => { mockRevoked.at(-1)!(); });
  expect(startForegroundService.mock.calls.at(-1)[1]).toBe('');
});
