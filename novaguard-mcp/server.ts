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

  constructor(options: McpServerOptions = {}) {
    this.client = options.client || new NovaGuardReadApiClient();
    this.authenticator = options.authenticator || new Authenticator();
    this.authorizer = options.authorizer || new Authorizer();
    this.auditLogger = options.auditLogger || new AuditLogger();
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

      if (!req.jsonrpc || req.jsonrpc !== '2.0') {
        throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid JSON-RPC version', 400);
      }

      let result: any;

      switch (req.method) {
        case 'initialize': {
          result = this.getCapabilities();
          break;
        }
        case 'ping': {
          result = {};
          break;
        }
        case 'tools/list': {
          result = { tools: ALL_TOOLS };
          break;
        }
        case 'tools/call': {
          const toolName = req.params?.name;
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
            content: [
              {
                type: 'text',
                text: JSON.stringify(output, null, 2),
              },
            ],
          };
          break;
        }
        case 'resources/list': {
          result = { resources: ALL_RESOURCE_TEMPLATES };
          break;
        }
        case 'resources/read': {
          const uri = req.params?.uri;
          operation = `resource:${uri}`;
          const res = await readResource(uri, this.client, this.authorizer, securityContext);

          if (res.blob) {
            mediaBytes = res.blob.length;
            result = {
              contents: [
                {
                  uri: res.uri,
                  mimeType: res.mimeType,
                  blob: res.blob.toString('base64'),
                },
              ],
            };
          } else {
            result = {
              contents: [
                {
                  uri: res.uri,
                  mimeType: res.mimeType,
                  text: res.text,
                },
              ],
            };
          }
          break;
        }
        default: {
          throw new McpError('NOVAGUARD_NOT_FOUND', `Method '${req.method}' not found`, 404);
        }
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

      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result,
      };
    } catch (err: any) {
      if (err instanceof McpError) {
        statusCode = err.status;
      } else {
        statusCode = 500;
      }

      const safeMessage = err.message || 'Internal server error';
      const errorCode = err.code || 'NOVAGUARD_DEVICE_UNAVAILABLE';

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
          data: {
            mcpErrorCode: errorCode,
          },
        },
      };
    }
  }
}
