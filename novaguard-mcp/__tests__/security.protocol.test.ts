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

  it('rejects revoked authentication tokens', () => {
    const authenticator = new Authenticator();
    const token = 'test-token-123456';
    authenticator.registerToken(token, 'test-client', ['novaguard:status']);
    authenticator.revokeToken(token);
    expect(() => authenticator.authenticate('192.0.2.10', token)).toThrow('Invalid authentication token');
  });

  it('rejects insufficient scopes', () => {
    const authenticator = new Authenticator();
    const token = 'test-token-123456';
    authenticator.registerToken(token, 'test-client', ['novaguard:status']);
    const context = authenticator.authenticate('192.0.2.10', token);
    expect(context.scopes).toEqual(['novaguard:status']);
  });
});
