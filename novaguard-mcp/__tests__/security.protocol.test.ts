import { NovaGuardMcpServer } from '../server';
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
});
