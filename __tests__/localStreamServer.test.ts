import { NativeModules } from 'react-native';
import { getLocalStreamServerStatus, startLocalStreamServer, stopLocalStreamServer } from '../src/surveillance/localStreamServer';

describe('LocalStreamServer wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles missing native module gracefully', async () => {
    delete (NativeModules as Record<string, unknown>).LocalStreamServer;
    const status = await startLocalStreamServer(8080);
    expect(status).toEqual({ running: false, port: 8080, ipAddress: null, url: null });

    const stop = await stopLocalStreamServer();
    expect(stop).toBe(true);

    const check = await getLocalStreamServerStatus();
    expect(check).toEqual({ running: false, port: 8080, ipAddress: null, url: null });
  });

  it('calls native methods when module is present', async () => {
    const mockModule = {
      startServer: jest.fn(async (port: number) => ({
        running: true,
        port,
        ipAddress: '192.168.1.50',
        url: `http://192.168.1.50:${port}`,
      })),
      stopServer: jest.fn(async () => true),
      getServerStatus: jest.fn(async () => ({
        running: true,
        port: 8080,
        ipAddress: '192.168.1.50',
        url: 'http://192.168.1.50:8080',
      })),
    };
    (NativeModules as Record<string, unknown>).LocalStreamServer = mockModule;

    const startResult = await startLocalStreamServer(8080);
    expect(mockModule.startServer).toHaveBeenCalledWith(8080);
    expect(startResult.running).toBe(true);
    expect(startResult.url).toBe('http://192.168.1.50:8080');

    const stopResult = await stopLocalStreamServer();
    expect(mockModule.stopServer).toHaveBeenCalled();
    expect(stopResult).toBe(true);

    const statusResult = await getLocalStreamServerStatus();
    expect(mockModule.getServerStatus).toHaveBeenCalled();
    expect(statusResult.ipAddress).toBe('192.168.1.50');
  });
});
