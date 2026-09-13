import { NovaGuardMcpServer } from '../server';
import { InMemoryNovaGuardApi, NovaGuardMockDataSource } from '../testing/inMemoryApi';

// Every request in this suite stands for a caller on the device. A transport
// has to name its peer — `authenticate` refuses to read a missing address as
// local — so these tests name it, exactly as the stdio and HTTP runners do.
const LOOPBACK = '127.0.0.1';

/**
 * Sends a request and asserts a response came back.
 *
 * `handleJsonRpcRequest` answers `null` to a notification, which is the point
 * of it. Every request in this suite carries an id, so a `null` here is the
 * server having mistaken one for the other.
 */
async function send(
  target: NovaGuardMcpServer,
  req: any,
  auth?: string,
  remote: string | undefined = LOOPBACK,
) {
  const res = await target.handleJsonRpcRequest(req, auth, remote);
  if (!res) throw new Error(`No response for ${req?.method} — treated as a notification?`);
  return res;
}


describe('NovaGuard MCP - Security Tests', () => {
  let server: NovaGuardMcpServer;

  beforeEach(() => {
    const mockData: NovaGuardMockDataSource = {
      surveillanceActive: true,
      camera: 'Arrière (1×)',
      lastDetectionAt: Date.now(),
      detectionsToday: 1,
      storage: { free: 100000, total: 500000 },
      settings: {
        camera: 'Arrière (1×)',
        person: true,
        animal: true,
        sens: 'Moyenne',
        threshold: 0.6,
        preciseDetection: false,
        autoZoom: true,
        zone: null,
        quality: '1080p',
        post: '10 s',
        max: '5 min',
        retention: '30 jours',
        autoDel: true,
        notif: true,
        notifDet: true,
        localStreamPin: 'SECRET_PIN_9999',
      },
      events: [
        {
          id: 1,
          kind: 'Personne',
          timestamp: Date.now(),
          dur: 10,
          conf: 0.9,
          path: '/data/user/0/com.novaguard.surveillance/files/clips/Personne_1.mp4',
          bytes: 1000,
          thumbPath: '/data/user/0/com.novaguard.surveillance/files/thumbs/1.jpg',
        },
      ],
    };

    server = new NovaGuardMcpServer({
      client: new InMemoryNovaGuardApi(mockData),
    });
  });

  test('rejects path traversal in resource URI', async () => {
    const res = await send(server, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'novaguard://video/1/../../../../etc/passwd' },
    }, undefined, LOOPBACK);

    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/NOVAGUARD_MEDIA_FORBIDDEN|NOVAGUARD_INVALID_ARGUMENT/);
  });

  test('rejects arbitrary URI schemes like file:// or content://', async () => {
    const res1 = await send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'file:///data/user/0/com.novaguard.surveillance/files/clips/Personne_1.mp4' },
    }, undefined, LOOPBACK);
    expect(res1.error).toBeDefined();

    const res2 = await send(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'content://media/external/images/media/1' },
    }, undefined, LOOPBACK);
    expect(res2.error).toBeDefined();
  });

  test('strictly rejects all state mutation tool calls', async () => {
    const forbiddenTools = [
      'start_surveillance',
      'stop_surveillance',
      'arm_camera',
      'disarm_camera',
      'set_camera',
      'set_detection_threshold',
      'set_detection_zone',
      'set_sensitivity',
      'set_recording_quality',
      'set_retention',
      'set_notification_settings',
      'delete_event',
      'delete_video',
      'clear_history',
      'change_stream_pin',
      'restart_camera',
      'update_configuration',
    ];

    for (const tool of forbiddenTools) {
      const res = await send(server, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: `novaguard.${tool}` },
      }, undefined, LOOPBACK);

      expect(res.error).toBeDefined();
      expect(res.error?.message).toContain('NOVAGUARD_INVALID_ARGUMENT');
    }
  });

  test('never exposes localStreamPin in configuration response', async () => {
    const res = await send(server, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'novaguard.get_configuration' },
    }, undefined, LOOPBACK);

    const configStr = res.result.content[0].text;
    expect(configStr).not.toContain('SECRET_PIN_9999');
    expect(configStr).not.toContain('localStreamPin');
  });

  test('never leaks internal filesystem paths in event metadata', async () => {
    const res = await send(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'novaguard.get_event', arguments: { eventId: 1 } },
    }, undefined, LOOPBACK);

    const eventStr = res.result.content[0].text;
    expect(eventStr).not.toContain('/data/user/0/com.novaguard.surveillance');
    expect(eventStr).toContain('novaguard://video/1');
  });

  test('audit logger does not record bearer tokens or media byte contents', async () => {
    await send(server, 
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'novaguard.get_status' } },
      'Bearer SUPER_SECRET_TOKEN_123',
      LOOPBACK
    );

    const logs = server.auditLogger.getLogs();
    expect(logs.length).toBeGreaterThan(0);
    const lastLogStr = JSON.stringify(logs[logs.length - 1]);
    expect(lastLogStr).not.toContain('SUPER_SECRET_TOKEN_123');
  });
});
