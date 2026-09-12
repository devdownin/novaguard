import { NovaGuardReadApiClient } from './client/NovaGuardReadApiClient';
import { Authenticator, SecurityContext } from './security/authentication';
import { Authorizer } from './security/authorization';
import { AuditLogger } from './security/audit';
import { ALL_TOOLS, executeToolCall } from './tools';
import { ALL_RESOURCE_TEMPLATES, readResource } from './resources';
import { McpError } from './types';

export interface McpServerOptions {
  client?: NovaGuardReadApiClient;
  authenticator?: Authenticator;
  authorizer?: Authorizer;
  auditLogger?: AuditLogger;
  maxThumbnailBytes?: number;
  maxVideoBytes?: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class NovaGuardMcpServer {
  public readonly client: NovaGuardReadApiClient;
  public readonly authenticator: Authenticator;
  public readonly authorizer: Authorizer;
  public readonly auditLogger: AuditLogger;
  private readonly maxThumbnailBytes: number;
  private readonly maxVideoBytes: number;

  constructor(options: McpServerOptions = {}) {
    this.client = options.client || new NovaGuardReadApiClient();
    this.authenticator = options.authenticator || new Authenticator();
    this.authorizer = options.authorizer || new Authorizer();
    this.auditLogger = options.auditLogger || new AuditLogger();
    this.maxThumbnailBytes = options.maxThumbnailBytes ?? 2 * 1024 * 1024;
    this.maxVideoBytes = options.maxVideoBytes ?? 20 * 1024 * 1024;
  }

  public getCapabilities() {
    return {
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: {
        name: 'novaguard-mcp',
        version: '1.0.0',
      },
      protocolVersion: '2026-07-28',
    };
  }

  public async handleJsonRpcRequest(
    req: JsonRpcRequest,
    authHeader?: string,
    remoteAddress?: string
  ): Promise<JsonRpcResponse> {
    const startMs = Date.now();
    let securityContext: SecurityContext = {
      principal: 'anonymous',
      scopes: [],
      isLoopback: true,
    };
    let operation = req.method || 'unknown';
    let eventId: number | null = null;
    let mediaBytes = 0;
    let statusCode = 200;

    try {
      securityContext = this.authenticator.authenticate(authHeader, remoteAddress);

      if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string' || !req.method) {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid JSON-RPC request', 400);
      }

      let result: any;

      switch (req.method) {
        case 'initialize':
          result = this.getCapabilities();
          break;
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools: ALL_TOOLS };
          break;
        case 'tools/call': {
          const toolName = req.params?.name;
          if (typeof toolName !== 'string' || !toolName) {
            throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Tool name is required', 400);
          }
          const toolArgs = req.params?.arguments || {};
          operation = `tool:${toolName}`;
          if (toolArgs.eventId !== undefined && typeof toolArgs.eventId === 'number') {
            eventId = toolArgs.eventId;
          }
          const output = await executeToolCall(
            toolName,
            toolArgs,
            this.client,
            this.authorizer,
            securityContext
          );
          result = {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          };
          break;
        }
        case 'resources/list':
          result = { resources: ALL_RESOURCE_TEMPLATES };
          break;
        case 'resources/read': {
          const uri = req.params?.uri;
          if (typeof uri !== 'string') {
            throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Resource URI is required', 400);
          }
          operation = `resource:${uri}`;
          const res = await readResource(uri, this.client, this.authorizer, securityContext);

          if (res.blob) {
            mediaBytes = res.blob.length;
            const isThumbnail = uri.startsWith('novaguard://thumbnail/');
            const maxBytes = isThumbnail ? this.maxThumbnailBytes : this.maxVideoBytes;
            if (mediaBytes > maxBytes) {
              throw new McpError(
                'NOVAGUARD_MEDIA_TOO_LARGE',
                `Media exceeds maximum size of ${maxBytes} bytes`,
                413
              );
            }
            result = {
              contents: [{
                uri: res.uri,
                mimeType: res.mimeType,
                blob: res.blob.toString('base64'),
              }],
            };
          } else {
            result = {
              contents: [{ uri: res.uri, mimeType: res.mimeType, text: res.text }],
            };
          }
          break;
        }
        default:
          throw new McpError('NOVAGUARD_NOT_FOUND', `Method '${req.method}' not found`, 404);
      }

      this.auditLogger.log({
        timestamp: new Date().toISOString(),
        principal: securityContext.principal,
        operation,
        eventId,
        status: 200,
        durationMs: Date.now() - startMs,
        mediaBytes,
      });

      return { jsonrpc: '2.0', id: req.id ?? null, result };
    } catch (err: any) {
      statusCode = err instanceof McpError ? err.status : 500;
      const errorCode = err instanceof McpError ? err.code : 'NOVAGUARD_DEVICE_UNAVAILABLE';
      const safeMessage = err instanceof McpError ? err.message : 'Internal server error';

      this.auditLogger.log({
        timestamp: new Date().toISOString(),
        principal: securityContext.principal,
        operation,
        eventId,
        status: statusCode,
        durationMs: Date.now() - startMs,
        mediaBytes: 0,
      });

      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: {
          code: statusCode === 404 ? -32601 : statusCode === 400 ? -32602 : -32603,
          message: `${errorCode}: ${safeMessage}`,
          data: { mcpErrorCode: errorCode },
        },
      };
    }
  }
}
