import { NovaGuardReadApiClient } from './client/NovaGuardReadApiClient';
import { Authenticator, SecurityContext } from './security/authentication';
import { Authorizer } from './security/authorization';
import { AuditLogger } from './security/audit';
import { ALL_TOOLS, executeToolCall } from './tools';
import { ALL_RESOURCE_TEMPLATES, readResource } from './resources';
import { McpError } from './types';

export interface McpServerOptions { client?: NovaGuardReadApiClient; authenticator?: Authenticator; authorizer?: Authorizer; auditLogger?: AuditLogger; maxThumbnailBytes?: number; maxVideoBytes?: number; }
export interface JsonRpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any; }
export interface JsonRpcResponse { jsonrpc: '2.0'; id?: string | number | null; result?: any; error?: { code: number; message: string; data?: any }; }
const MCP_PROTOCOL_VERSION = '2026-07-28';

export class NovaGuardMcpServer {
  public readonly client: NovaGuardReadApiClient;
  public readonly authenticator: Authenticator;
  public readonly authorizer: Authorizer;
  public readonly auditLogger: AuditLogger;
  private readonly maxThumbnailBytes: number;
  private readonly maxVideoBytes: number;

  constructor(options: McpServerOptions = {}) {
    this.client = options.client || new NovaGuardReadApiClient();
    this.validateClientEndpoint(this.client);
    this.authenticator = options.authenticator || new Authenticator();
    this.authorizer = options.authorizer || new Authorizer();
    this.auditLogger = options.auditLogger || new AuditLogger();
    this.maxThumbnailBytes = options.maxThumbnailBytes ?? 2 * 1024 * 1024;
    this.maxVideoBytes = options.maxVideoBytes ?? 20 * 1024 * 1024;
  }

  private validateClientEndpoint(client: NovaGuardReadApiClient): void {
    const baseUrl = (client as any).baseUrl as string | undefined;
    if (!baseUrl) return;
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new Error('Invalid NovaGuard API baseUrl'); }
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === '::ffff:127.0.0.1';
    if (!loopback || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('NovaGuard MCP only permits loopback API endpoints');
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') throw new Error('NovaGuard API baseUrl must not contain a path');
  }

  public getCapabilities() {
    return { capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'novaguard-mcp', version: '1.0.0' }, protocolVersion: MCP_PROTOCOL_VERSION };
  }

  private validateJsonRpcRequest(req: any): asserts req is JsonRpcRequest {
    if (!req || typeof req !== 'object' || Array.isArray(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string' || req.method.length === 0 || req.method.length > 128) throw new McpError('NOVAGUARD_INVALID_REQUEST', 'Invalid JSON-RPC request', 400);
    if (Object.prototype.hasOwnProperty.call(req, 'id') && req.id !== null && typeof req.id !== 'string' && typeof req.id !== 'number') throw new McpError('NOVAGUARD_INVALID_REQUEST', 'Invalid JSON-RPC id', 400);
    if (req.params !== undefined && (!req.params || typeof req.params !== 'object' || Array.isArray(req.params))) throw new McpError('NOVAGUARD_INVALID_REQUEST', 'JSON-RPC params must be an object', 400);
  }

  private validateInitialize(params: any): void {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new McpError('NOVAGUARD_INVALID_REQUEST', 'initialize params are required', 400);
    if (params.protocolVersion !== MCP_PROTOCOL_VERSION) throw new McpError('NOVAGUARD_INVALID_REQUEST', `Unsupported MCP protocol version. Expected ${MCP_PROTOCOL_VERSION}`, 400);
    if (!params.capabilities || typeof params.capabilities !== 'object' || Array.isArray(params.capabilities)) throw new McpError('NOVAGUARD_INVALID_REQUEST', 'initialize capabilities are required', 400);
    if (!params.clientInfo || typeof params.clientInfo !== 'object' || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') throw new McpError('NOVAGUARD_INVALID_REQUEST', 'initialize clientInfo is required', 400);
  }

  public async handleJsonRpcRequest(req: JsonRpcRequest, authHeader?: string, remoteAddress?: string): Promise<JsonRpcResponse> {
    const startMs = Date.now();
    let securityContext: SecurityContext = { principal: 'anonymous', scopes: [], isLoopback: true };
    let operation = 'unknown'; let eventId: number | null = null; let mediaBytes = 0; let statusCode = 200; let requestId: string | number | null = null;
    try {
      requestId = req && typeof req === 'object' && 'id' in req ? (req.id ?? null) : null;
      operation = req && typeof req === 'object' && typeof req.method === 'string' ? req.method : 'unknown';
      securityContext = this.authenticator.authenticate(authHeader, remoteAddress);
      this.validateJsonRpcRequest(req);
      let result: any;
      switch (req.method) {
        case 'initialize': this.validateInitialize(req.params); result = this.getCapabilities(); break;
        case 'ping': result = {}; break;
        case 'notifications/initialized': result = {}; break;
        case 'tools/list': result = { tools: ALL_TOOLS }; break;
        case 'tools/call': {
          const toolName = req.params?.name;
          if (typeof toolName !== 'string' || toolName.length === 0 || toolName.length > 128) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Tool name is required', 400);
          const toolArgs = req.params?.arguments ?? {};
          if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Tool arguments must be an object', 400);
          operation = `tool:${toolName}`; if (typeof toolArgs.eventId === 'number') eventId = toolArgs.eventId;
          const output = await executeToolCall(toolName, toolArgs, this.client, this.authorizer, securityContext);
          result = { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] }; break;
        }
        case 'resources/list': result = { resources: ALL_RESOURCE_TEMPLATES }; break;
        case 'resources/read': {
          const uri = req.params?.uri;
          if (typeof uri !== 'string' || uri.length === 0 || uri.length > 512) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Resource URI is required', 400);
          operation = `resource:${uri}`;
          const res = await readResource(uri, this.client, this.authorizer, securityContext);
          if (res.blob) {
            mediaBytes = res.blob.length;
            const maxBytes = uri.startsWith('novaguard://thumbnail/') ? this.maxThumbnailBytes : this.maxVideoBytes;
            if (mediaBytes > maxBytes) throw new McpError('NOVAGUARD_MEDIA_TOO_LARGE', 'Media exceeds configured maximum size', 413);
            result = { contents: [{ uri: res.uri, mimeType: res.mimeType, blob: res.blob.toString('base64') }] };
          } else result = { contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text }] };
          break;
        }
        default: throw new McpError('NOVAGUARD_NOT_FOUND', `Method '${req.method}' not found`, 404);
      }
      this.auditLogger.log({ timestamp: new Date().toISOString(), principal: securityContext.principal, operation, eventId, status: 200, durationMs: Date.now() - startMs, mediaBytes });
      return { jsonrpc: '2.0', id: requestId, result };
    } catch (err: any) {
      statusCode = err instanceof McpError ? err.status : 500;
      const errorCode = err instanceof McpError ? err.code : 'NOVAGUARD_DEVICE_UNAVAILABLE';
      const safeMessage = err instanceof McpError ? err.message : 'Internal server error';
      this.auditLogger.log({ timestamp: new Date().toISOString(), principal: securityContext.principal, operation, eventId, status: statusCode, durationMs: Date.now() - startMs, mediaBytes: 0 });
      return { jsonrpc: '2.0', id: requestId, error: { code: errorCode === 'NOVAGUARD_INVALID_REQUEST' ? -32600 : statusCode === 404 ? -32601 : statusCode === 400 ? -32602 : -32603, message: `${errorCode}: ${safeMessage}`, data: { mcpErrorCode: errorCode } } };
    }
  }
}
