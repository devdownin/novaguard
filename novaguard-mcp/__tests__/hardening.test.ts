/**
 * The P2 findings from the MCP audit, each locked by what it costs when absent.
 *
 * None of these stop a request from working, which is why none of them had a
 * test: a token compared with `===` authenticates exactly the same callers as
 * one compared in constant time, and an unbounded table is correct until the
 * process runs out of memory.
 */

import * as http from 'http';
import { inspect } from 'util';
import { Authenticator } from '../security/authentication';
import { McpHttpServer } from '../transport/httpServer';
import { NovaGuardMcpServer } from '../server';
import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';

const TOKEN = 'token-0123456789abcdef';

describe('bearer tokens', () => {
  it('never holds the token itself', () => {
    // Stored by digest, so a heap dump, a log of the object or an accidental
    // serialisation cannot hand the credential back.
    const authenticator = new Authenticator({ expectedToken: TOKEN });
    authenticator.registerToken(TOKEN, { principal: 'p', scopes: ['novaguard:read'], isLoopback: false });
    expect(inspect(authenticator, { depth: 6 })).not.toContain(TOKEN);
  });

  it('accepts the registered token and refuses a near miss', () => {
    const authenticator = new Authenticator();
    authenticator.registerToken(TOKEN, { principal: 'p', scopes: ['novaguard:read'], isLoopback: false });

    expect(authenticator.authenticate(`Bearer ${TOKEN}`, '192.0.2.10').principal).toBe('p');
    // One byte different, and every prefix of the real token: a comparison
    // that returns early would take measurably longer on the longer prefixes.
    for (const wrong of [`${TOKEN.slice(0, -1)}0`, TOKEN.slice(0, 4), `${TOKEN}x`, TOKEN.toUpperCase()]) {
      expect(() => authenticator.authenticate(`Bearer ${wrong}`, '192.0.2.10')).toThrow('Authentication token is required');
    }
    // Surrounding whitespace is header noise, not part of the credential.
    expect(authenticator.authenticate(`Bearer  ${TOKEN} `, '192.0.2.10').principal).toBe('p');
  });

  it('honours the configured expected token through the same path', () => {
    const authenticator = new Authenticator({ expectedToken: TOKEN });
    expect(authenticator.authenticate(`Bearer ${TOKEN}`, '192.0.2.10').principal).toBe('mcp-bearer-user');
    expect(() => authenticator.authenticate(`Bearer ${TOKEN.slice(0, -1)}0`, '192.0.2.10')).toThrow();

    authenticator.setExpectedToken(undefined);
    expect(() => authenticator.authenticate(`Bearer ${TOKEN}`, '192.0.2.10')).toThrow();
  });

  it('forgets a revoked token', () => {
    const authenticator = new Authenticator();
    authenticator.registerToken(TOKEN, { principal: 'p', scopes: ['novaguard:read'], isLoopback: false });
    expect(authenticator.revokeToken(TOKEN)).toBe(true);
    expect(authenticator.revokeToken(TOKEN)).toBe(false);
    expect(() => authenticator.authenticate(`Bearer ${TOKEN}`, '192.0.2.10')).toThrow();
  });
});

describe('the upstream guard', () => {
  const client = () => new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8099', fetchFn: jest.fn() });

  it('wraps a client once, however many servers share it', () => {
    // Two wraps meant two rounds of upstream validation per request and two
    // redirect handlers stacked on each other.
    const shared = client();
    expect(new NovaGuardMcpServer({ client: shared })).toBeDefined();
    expect(shared.guardRequests(fn => fn)).toBe(false);
  });

  it('refuses a Request object rather than stringifying it', async () => {
    // A Request carries its own url, method and headers, which would travel
    // past every check above as "[object Request]".
    const guarded = client();
    expect(new NovaGuardMcpServer({ client: guarded })).toBeDefined();
    await expect((guarded as any).fetchFn(new Request('http://127.0.0.1:8099/x')))
      .rejects.toMatchObject({ code: 'NOVAGUARD_DEVICE_UNAVAILABLE' });
  });
});

describe('media ceilings', () => {
  /**
   * A body that reports how much of it the caller actually pulled.
   *
   * The cast is a type-environment mismatch, not a lie: this suite runs under
   * the React Native preset, whose `BodyInit_` predates streaming bodies,
   * while the code under test runs on Node, where a `ReadableStream` body is
   * exactly what `fetch` returns and what the client reads.
   */
  function countingBody(totalBytes: number, chunkBytes = 64 * 1024) {
    const state = { delivered: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.delivered >= totalBytes) return controller.close();
        const size = Math.min(chunkBytes, totalBytes - state.delivered);
        state.delivered += size;
        controller.enqueue(new Uint8Array(size));
      },
      cancel() { state.cancelled = true; },
    });
    return { stream, state };
  }

  it('stops a thumbnail at the thumbnail ceiling, not the client-wide one', async () => {
    // The server refuses a thumbnail over 2 MB. It used to do so *after* the
    // client had read the whole body under its own 20 MB cap, so an 8 MB
    // thumbnail was downloaded in full and then discarded.
    const { stream, state } = countingBody(8 * 1024 * 1024);
    const fetchFn = jest.fn(async () => new Response(stream as any, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const server = new NovaGuardMcpServer({
      client: new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8099', fetchFn, maxMediaBytes: 20 * 1024 * 1024 }),
      maxThumbnailBytes: 2 * 1024 * 1024,
    });

    const res = (await server.handleJsonRpcRequest(
      { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'novaguard://thumbnail/1' } },
      undefined, '127.0.0.1'))!;

    expect(res.error?.message).toContain('NOVAGUARD_MEDIA_TOO_LARGE');
    expect(state.cancelled).toBe(true);
    // Never more than a chunk past the ceiling, and nowhere near the 8 MB body.
    expect(state.delivered).toBeLessThan(3 * 1024 * 1024);
  });

  it('lets a clip use the larger video ceiling', async () => {
    const { stream } = countingBody(3 * 1024 * 1024);
    const fetchFn = jest.fn(async () => new Response(stream as any, { status: 200, headers: { 'content-type': 'video/mp4' } }));
    const server = new NovaGuardMcpServer({
      client: new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8099', fetchFn }),
      maxThumbnailBytes: 2 * 1024 * 1024,
      maxVideoBytes: 20 * 1024 * 1024,
    });

    const res = (await server.handleJsonRpcRequest(
      { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'novaguard://video/1' } },
      undefined, '127.0.0.1'))!;

    expect(res.error).toBeUndefined();
    expect(res.result.contents[0].mimeType).toBe('video/mp4');
  });
});

describe('the HTTP transport guards', () => {
  let server: McpHttpServer;
  const port = 18282;
  const url = `http://127.0.0.1:${port}/mcp`;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const json = { 'Content-Type': 'application/json' };

  beforeAll(async () => {
    server = new McpHttpServer({ port, maxRequestsPerWindow: 10_000 });
    await server.start();
  });

  afterAll(async () => { await server.stop(); });

  it('answers a request carrying the address it listens on', async () => {
    const res = await fetch(url, { method: 'POST', headers: json, body });
    expect(res.status).toBe(200);
  });

  /**
   * `fetch` refuses to send a `Host` a caller sets — it is a forbidden header
   * name — so the one request this suite most needs to make goes out through
   * the raw client, which is also what an attacker would use.
   */
  function postWithHost(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { ...json, Host: host, 'Content-Length': Buffer.byteLength(body) } },
        res => { res.resume(); resolve(res.statusCode ?? 0); },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  it('refuses a Host it does not answer to', async () => {
    // The other half of the DNS-rebinding defence: a page whose hostname has
    // been pointed at this device reaches the socket, and its Host says so.
    await expect(postWithHost('evil.example')).resolves.toBe(421);
    await expect(postWithHost(`127.0.0.1:${port}`)).resolves.toBe(200);
    await expect(postWithHost(`localhost:${port}`)).resolves.toBe(200);
  });

  it('refuses a foreign Origin and allows an absent one', async () => {
    const foreign = await fetch(url, { method: 'POST', headers: { ...json, Origin: 'http://evil.example' }, body });
    expect(foreign.status).toBe(403);

    // Origin is a browser header; an ordinary MCP client sends none, which is
    // why Host is checked as well.
    const none = await fetch(url, { method: 'POST', headers: json, body });
    expect(none.status).toBe(200);
  });

  it('says how to authenticate when it answers 401', async () => {
    const authServer = new McpHttpServer({ port: port + 1, server: new NovaGuardMcpServer() });
    await authServer.start();
    try {
      // A caller the server cannot place as local: no token, so 401 — and a
      // 401 without WWW-Authenticate leaves a conforming client no scheme to
      // satisfy, which is what the MCP authorization flow is built on.
      const res = await (authServer as any).mcpServer.handleJsonRpcRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined, '192.0.2.10');
      expect(res.error?.data?.mcpErrorCode).toBe('NOVAGUARD_AUTH_REQUIRED');
      expect((authServer as any).responseHeaders(401)['WWW-Authenticate']).toBe('Bearer realm="NovaGuard MCP"');
    } finally {
      await authServer.stop();
    }
  });
});

describe('the rate-limit table', () => {
  it('stays bounded when every caller has a different address', async () => {
    // One entry per peer that ever connected, swept only on stop(), is a slow
    // leak on a server meant to run for weeks.
    const server = new McpHttpServer({ port: 18283, maxRequestsPerWindow: 5 });
    const allow = (server as any).isAllowed.bind(server);

    for (let i = 0; i < 5_000; i += 1) allow(`10.0.${Math.floor(i / 256)}.${i % 256}`);

    expect((server as any).requestCounts.size).toBeLessThanOrEqual(1_024);
  });

  it('still counts a single caller against its window', async () => {
    // The other half: eviction must not become a way to reset an allowance.
    const server = new McpHttpServer({ port: 18284, maxRequestsPerWindow: 3 });
    const allow = (server as any).isAllowed.bind(server);

    expect([allow('10.0.0.1'), allow('10.0.0.1'), allow('10.0.0.1')]).toEqual([true, true, true]);
    expect(allow('10.0.0.1')).toBe(false);
  });
});
