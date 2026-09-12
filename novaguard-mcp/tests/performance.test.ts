import { NovaGuardMcpServer } from '../server';
import { NovaGuardReadApiClient, RawEvent, NovaGuardMockDataSource } from '../client/NovaGuardReadApiClient';

describe('NovaGuard MCP - Performance Tests', () => {
  let server: NovaGuardMcpServer;

  beforeAll(() => {
    // Generate 10,000 simulated events across 30 days
    const events: RawEvent[] = [];
    const baseTime = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (let i = 1; i <= 10000; i++) {
      events.push({
        id: i,
        kind: i % 2 === 0 ? 'Personne' : 'Animal',
        timestamp: baseTime + i * 250000, // distributed sequentially
        dur: 15,
        conf: 0.85,
        path: `/app/clips/${i}.mp4`,
        bytes: 1000000,
        thumbPath: `/app/thumbs/${i}.jpg`,
      });
    }

    const mockData: NovaGuardMockDataSource = {
      surveillanceActive: true,
      camera: 'Arrière (1×)',
      lastDetectionAt: Date.now(),
      detectionsToday: 300,
      storage: { free: 50000000000, total: 100000000000 },
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
      },
      events,
    };

    server = new NovaGuardMcpServer({
      client: new NovaGuardReadApiClient({ mockDataSource: mockData }),
    });
  });

  test('searches 10,000 events in under 100ms with pagination', async () => {
    const startTime = Date.now();
    const from = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'novaguard.search_events',
        arguments: {
          from,
          to,
          kind: 'Personne',
          limit: 20,
          offset: 100,
        },
      },
    });

    const duration = Date.now() - startTime;
    expect(res.error).toBeUndefined();
    const data = JSON.parse(res.result.content[0].text);

    expect(data.total).toBe(5000);
    expect(data.events.length).toBe(20);
    expect(data.offset).toBe(100);
    expect(duration).toBeLessThan(100);
  });

  test('calculates statistics over 10,000 events fast without memory issues', async () => {
    const startTime = Date.now();

    const from = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    const res = await server.handleJsonRpcRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'novaguard.get_statistics',
        arguments: {
          from,
          to,
          groupBy: 'kind',
        },
      },
    });

    const duration = Date.now() - startTime;
    expect(res.error).toBeUndefined();
    const stats = JSON.parse(res.result.content[0].text);

    expect(stats.total).toBe(10000);
    expect(stats.persons).toBe(5000);
    expect(stats.animals).toBe(5000);
    expect(duration).toBeLessThan(200);
  });
});
