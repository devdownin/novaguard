import { NovaGuardMcpServer } from '../server';
import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Sanitizer } from '../security/sanitizer';
import { Authenticator } from '../security/authentication';

describe('NovaGuard MCP security', () => {
  it('rejects malformed JSON-RPC requests with -32600', async () => {
    const server = new NovaGuardMcpServer();
    const response = await server.handleJsonRpcRequest(null as any, undefined, '127.0.0.1');
    expect(response.error?.code).toBe(-32600);
    expect(response.error?.data?.mcpErrorCode).toBe('NOVAGUARD_INVALID_REQUEST');
  });

  it('validates the MCP initialize handshake', async () => {
    const server = new NovaGuardMcpServer();
    const response = await server.handleJsonRpcRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } },
    }, undefined, '127.0.0.1');
    expect(response.error).toBeUndefined();
    expect(response.result.protocolVersion).toBe('2026-07-28');
  });

  it('rejects an unsupported MCP protocol version', async () => {
    const server = new NovaGuardMcpServer();
    const response = await server.handleJsonRpcRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } },
    }, undefined, '127.0.0.1');
    expect(response.error?.data?.mcpErrorCode).toBe('NOVAGUARD_INVALID_REQUEST');
  });

  it('rejects invalid calendar dates in resource URIs', () => {
    expect(() => Sanitizer.validateResourceUri('novaguard://timeline/2026-02-30')).toThrow('Invalid calendar date');
    expect(() => Sanitizer.validateResourceUri('novaguard://statistics/365d')).toThrow('Invalid statistics period');
  });

  it('does not treat a missing remote address as loopback', () => {
    const authenticator = new Authenticator();
    expect(() => authenticator.authenticate(undefined, undefined)).toThrow('Authentication token is required for non-loopback connections');
  });

  it('blocks non-loopback upstream endpoints from the MCP server', () => {
    const client = new NovaGuardReadApiClient({ baseUrl: 'https://example.com', authToken: 'test-token-123456' });
    expect(() => new NovaGuardMcpServer({ client })).toThrow('only permits loopback API endpoints');
  });

  it('blocks private and metadata upstream endpoints from the MCP server', () => {
    for (const baseUrl of [
      'http://10.0.0.10:8080',
      'http://192.168.1.10:8080',
      'http://172.16.0.10:8080',
      'http://169.254.169.254/latest/meta-data',
    ]) {
      const client = new NovaGuardReadApiClient({ baseUrl });
      expect(() => new NovaGuardMcpServer({ client })).toThrow('only permits loopback API endpoints');
    }
  });

  it('allows the local NovaGuard API endpoint', () => {
    const client = new NovaGuardReadApiClient({ baseUrl: 'http://127.0.0.1:8080' });
    expect(() => new NovaGuardMcpServer({ client })).not.toThrow();
  });

  it('rejects oversized media before downloading the body when Content-Length is known', async () => {
    const fetchFn = jest.fn(async () => new Response('not downloaded', {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': String(21 * 1024 * 1024) },
    }));
    const client = new NovaGuardReadApiClient({
      baseUrl: 'http://127.0.0.1:8080',
      fetchFn,
      maxMediaBytes: 20 * 1024 * 1024,
    });

    await expect(client.getVideo(1)).rejects.toMatchObject({ code: 'NOVAGUARD_MEDIA_TOO_LARGE' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // Both tests below called registerToken(token, principal, scopes) and
  // authenticate(address, token) — neither signature exists, so they could
  // never pass and they were the two `tsc` errors on this tree. Rewritten
  // against the real API, keeping what they were plainly meant to assert.

  it('rejects revoked authentication tokens', () => {
    const authenticator = new Authenticator();
    const token = 'test-token-123456';
    authenticator.registerToken(token, { principal: 'test-client', scopes: ['novaguard:status'], isLoopback: false });
    authenticator.revokeToken(token);
    expect(() => authenticator.authenticate(`Bearer ${token}`, '192.0.2.10')).toThrow('Authentication token is required for non-loopback connections');
  });

  it('grants a registered token exactly the scopes it was given', () => {
    const authenticator = new Authenticator();
    const token = 'test-token-123456';
    authenticator.registerToken(token, { principal: 'test-client', scopes: ['novaguard:status'], isLoopback: false });
    const context = authenticator.authenticate(`Bearer ${token}`, '192.0.2.10');
    expect(context.scopes).toEqual(['novaguard:status']);
    expect(context.principal).toBe('test-client');
  });

  it('grants the umbrella scope on loopback so status is reachable', async () => {
    // Regression: `get_status`, `get_storage` and `novaguard://status` require
    // `novaguard:read`, which no principal could hold — the scope was missing
    // from MCP_SCOPES, so the three of them answered AUTH_FORBIDDEN to
    // everyone, loopback included, and the HTTP transport's /status route
    // could only ever return 500.
    const server = new NovaGuardMcpServer({
      client: new NovaGuardReadApiClient({
        mockDataSource: {
          surveillanceActive: true, camera: 'Arrière (1×)', lastDetectionAt: null,
          detectionsToday: 0, storage: { free: 1_000, total: 2_000 },
          settings: {} as any, events: [],
        },
      }),
    });

    for (const req of [
      { jsonrpc: '2.0' as const, id: 1, method: 'tools/call', params: { name: 'novaguard.get_status', arguments: {} } },
      { jsonrpc: '2.0' as const, id: 2, method: 'tools/call', params: { name: 'novaguard.get_storage', arguments: {} } },
      { jsonrpc: '2.0' as const, id: 3, method: 'resources/read', params: { uri: 'novaguard://status' } },
    ]) {
      const res = await server.handleJsonRpcRequest(req, undefined, '127.0.0.1');
      expect(res.error).toBeUndefined();
    }
  });
});
