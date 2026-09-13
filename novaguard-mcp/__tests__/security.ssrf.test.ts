import { NovaGuardMcpServer } from '../server';
import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';

describe('P2.2 upstream SSRF protections', () => {
  test('rejects a client endpoint outside the loopback allowlist', () => {
    expect(() => new NovaGuardMcpServer({ client: new NovaGuardReadApiClient({ baseUrl: 'http://169.254.169.254' }) })).toThrow();
    expect(() => new NovaGuardMcpServer({ client: new NovaGuardReadApiClient({ baseUrl: 'http://10.0.0.1' }) })).toThrow();
  });

  test('does not follow a cross-origin redirect', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'http://127.0.0.1:8082/redirected' } }));
    const client = new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8081', fetchFn });
    const server = new NovaGuardMcpServer({ client });
    await expect(server.client.getStatus()).rejects.toMatchObject({ code: 'NOVAGUARD_DEVICE_UNAVAILABLE' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
