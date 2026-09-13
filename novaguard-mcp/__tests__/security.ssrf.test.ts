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

  test('reaches a loopback upstream on a non-standard port', async () => {
    // The port allowlist was 80/443 for every host, so the only endpoint
    // `validateClientEndpoint` accepts — the device's own read API, which
    // listens above 1024 — was unreachable and `fetch` was never called. The
    // test above is what caught it: it asserts one call and was getting zero.
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ surveillanceActive: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8099', fetchFn });
    // Constructing the server is what wraps the client's fetch in the upstream
    // checks; the server itself is not what this asserts on.
    expect(new NovaGuardMcpServer({ client })).toBeDefined();
    await expect(client.getStatus()).resolves.toMatchObject({ surveillanceActive: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('still refuses a non-standard port off the device', async () => {
    const fetchFn = jest.fn();
    const client = new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8099', fetchFn });
    expect(new NovaGuardMcpServer({ client })).toBeDefined();
    await expect((client as any).fetchFn('http://example.com:9001/x', {})).rejects.toMatchObject({ code: 'NOVAGUARD_DEVICE_UNAVAILABLE' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
