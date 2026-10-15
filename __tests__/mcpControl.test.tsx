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
jest.mock('../src/surveillance/mcpServer', () => {
  const actual = jest.requireActual('../src/surveillance/mcpServer');
  return {
    ...actual,
    onMcpCommand: jest.fn((handler: (request: McpCommandRequest) => void) => { mockHandlers.push(handler); return mockUnsubscribe; }),
    resolveMcpCommand: jest.fn(),
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
  expect(native.startServer).toHaveBeenLastCalledWith(8081, '', 'mcp_' + 'c'.repeat(32), true);

  await ReactTestRenderer.act(async () => { handle.state.toggleMcpControl(); });
  expect(mockUnsubscribe).toHaveBeenCalled();
  expect(native.startServer).toHaveBeenLastCalledWith(8081, '', 'mcp_' + 'c'.repeat(32), false);
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
