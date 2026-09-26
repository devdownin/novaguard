import { NativeModules } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mountProvider } from '../testing/mountProvider';
import { defaultSettings } from '../src/state/defaults';

jest.mock('../src/surveillance/foregroundService');

const pin = '123456789012';
const native = {
  generatePin: jest.fn(async () => pin),
  startServer: jest.fn(async (port: number) => ({
    running: true, port, ipAddress: '192.168.1.2', url: `http://192.168.1.2:${port}`, hasPin: true,
  })),
  stopServer: jest.fn(async () => true),
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (NativeModules as Record<string, unknown>).LocalStreamServer = native;
});

afterEach(() => { jest.useRealTimers(); });

it('generates a PIN before exposing the stream on the network', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleLocalStream(); });
  expect(native.generatePin).toHaveBeenCalledTimes(1);
  expect(native.startServer).toHaveBeenCalledWith(defaultSettings.localStreamPort, pin);
  expect(handle.state.localStreamStatus.running).toBe(true);

  await ReactTestRenderer.act(async () => { handle.state.toggleLocalStream(); });
  expect(native.stopServer).toHaveBeenCalled();
});

it('replaces an old empty PIN before restarting a persisted stream', async () => {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings, localStreamEnabled: true, localStreamPin: '',
  }));
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => {});
  expect(native.startServer).toHaveBeenCalledWith(defaultSettings.localStreamPort, pin);
  expect(handle.state.settings.localStreamPin).toBe(pin);
});

it('keeps the stream closed when PIN generation fails', async () => {
  native.generatePin.mockRejectedValueOnce(new Error('no secure generator'));
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleLocalStream(); });
  expect(native.startServer).not.toHaveBeenCalled();
  expect(handle.state.settings.localStreamEnabled).toBe(false);
});
