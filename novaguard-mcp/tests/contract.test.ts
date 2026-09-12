import { NovaGuardMcpServer } from '../server';
import { NovaGuardReadApiClient, NovaGuardMockDataSource } from '../client/NovaGuardReadApiClient';
import { Authenticator } from '../security/authentication';

describe('NovaGuard MCP - Contract Tests', () => {
  let server: NovaGuardMcpServer;
  let client: NovaGuardReadApiClient;
  let mockData: NovaGuardMockDataSource;

  beforeEach(() => {
    mockData = {
      surveillanceActive: true,
      camera: 'Arrière (1×)',
      lastDetectionAt: 1789200000000,
      detectionsToday: 4,
      storage: {
        free: 12884901888,
        total: 67108864000,
      },
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
        localStreamPin: '1234',
      },
      events: [
        {
          id: 1042,
          kind: 'Personne',
          timestamp: Date.now() - 3600000,
          dur: 18,
          conf: 0.94,
          path: '/app/videos/1042.mp4',
          bytes: 18432000,
          thumbPath: '/app/thumbs/1042.jpg',
          thumbnailBuffer: Buffer.from('thumb-1042'),
          videoBuffer: Buffer.from('video-1042'),
        },
        {
          id: 1043,
          kind: 'Animal',
          timestamp: Date.now() - 1800000,
          dur: 7,
          conf: 0.88,
          path: null, // Event without video
          bytes: 0,
          thumbPath: null,
        },
      ],
    };

    client = new NovaGuardReadApiClient({ mockDataSource: mockData });
    server = new NovaGuardMcpServer({ client });
  });

  test('initialize returns protocol 2026-07-28 and capabilities', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });

    expect(res.result.protocolVersion).toBe('2026-07-28');
    expect(res.result.capabilities.tools).toEqual({ listChanged: false });
    expect(res.result.capabilities.resources).toEqual({ subscribe: false, listChanged: false });
  });

  test('novaguard.get_status returns status without sensitive data', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'novaguard.get_status' },
    });

    const data = JSON.parse(res.result.content[0].text);
    expect(data.surveillanceActive).toBe(true);
    expect(data.camera).toBe('Arrière (1×)');
    expect(data.storage.usedBytes).toBe(18432000);
    expect(data.localStreamPin).toBeUndefined();
    expect(data.path).toBeUndefined();
  });

  test('novaguard.search_events filters and paginates correctly', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'novaguard.search_events',
        arguments: {
          kind: 'Personne',
          limit: 10,
        },
      },
    });

    const data = JSON.parse(res.result.content[0].text);
    expect(data.events.length).toBe(1);
    expect(data.events[0].id).toBe(1042);
    expect(data.events[0].videoResourceUri).toBe('novaguard://video/1042');
    expect(data.events[0].thumbnailResourceUri).toBe('novaguard://thumbnail/1042');
    expect(data.events[0].path).toBeUndefined(); // Internal path hidden!
  });

  test('novaguard.search_events rejects range greater than 90 days', async () => {
    const from = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'novaguard.search_events',
        arguments: { from, to },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('NOVAGUARD_RANGE_TOO_LARGE');
  });

  test('novaguard.get_event handles event without video', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'novaguard.get_event',
        arguments: { eventId: 1043 },
      },
    });

    const data = JSON.parse(res.result.content[0].text);
    expect(data.id).toBe(1043);
    expect(data.hasVideo).toBe(false);
    expect(data.videoResourceUri).toBeNull();
    expect(data.thumbnailResourceUri).toBeNull();
  });

  test('novaguard.get_event returns 404 for non-existent event', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'novaguard.get_event',
        arguments: { eventId: 9999 },
      },
    });

    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('NOVAGUARD_NOT_FOUND');
  });

  test('resources/read for video returns video content', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/read',
      params: { uri: 'novaguard://video/1042' },
    });

    expect(res.result.contents[0].mimeType).toBe('video/mp4');
    expect(res.result.contents[0].blob).toBe(Buffer.from('video-1042').toString('base64'));
  });

  test('resources/read for video deleted by retention returns NOVAGUARD_MEDIA_UNAVAILABLE', async () => {
    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/read',
      params: { uri: 'novaguard://video/1043' },
    });

    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('NOVAGUARD_MEDIA_UNAVAILABLE');
  });

  test('authentication failure on non-loopback connection', async () => {
    const customAuth = new Authenticator({ requireAuthForNonLoopback: true });
    const authServer = new NovaGuardMcpServer({ authenticator: customAuth, client });

    const res = await authServer.handleJsonRpcRequest(
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      undefined,
      '192.168.1.50' // Non-loopback IP
    );

    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('NOVAGUARD_AUTH_REQUIRED');
  });

  test('authorization failure when media read scope is missing', async () => {
    const authenticator = new Authenticator();
    authenticator.registerToken('limited-token', {
      principal: 'limited-user',
      scopes: ['novaguard:events:read'], // missing novaguard:media:read
      isLoopback: false,
    });

    const authServer = new NovaGuardMcpServer({ authenticator, client });

    const res = await authServer.handleJsonRpcRequest(
      { jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'novaguard://video/1042' } },
      'Bearer limited-token',
      '192.168.1.50'
    );

    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('NOVAGUARD_AUTH_FORBIDDEN');
  });
});
