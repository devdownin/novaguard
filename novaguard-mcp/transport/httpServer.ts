import * as http from 'http';
import { NovaGuardMcpServer } from '../server';

export interface HttpServerOptions {
  port?: number;
  host?: string;
  server?: NovaGuardMcpServer;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  maxRequestsPerWindow?: number;
  rateLimitWindowMs?: number;
}

export class McpHttpServer {
  public readonly port: number;
  public readonly host: string;
  public readonly mcpServer: NovaGuardMcpServer;
  private readonly maxBodyBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly maxRequestsPerWindow: number;
  private readonly rateLimitWindowMs: number;
  private readonly requestCounts = new Map<string, { count: number; resetAt: number }>();
  private server: http.Server | null = null;

  constructor(options: HttpServerOptions = {}) {
    this.port = options.port ?? 8081;
    this.host = options.host ?? '127.0.0.1';
    this.maxBodyBytes = options.maxBodyBytes ?? 256 * 1024;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxRequestsPerWindow = options.maxRequestsPerWindow ?? 120;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
    this.mcpServer = options.server || new NovaGuardMcpServer();
  }

  private isAllowed(remoteAddress: string): boolean {
    const now = Date.now();
    const current = this.requestCounts.get(remoteAddress);

    if (!current || current.resetAt <= now) {
      this.requestCounts.set(remoteAddress, {
        count: 1,
        resetAt: now + this.rateLimitWindowMs,
      });
      return true;
    }

    if (current.count >= this.maxRequestsPerWindow) {
      return false;
    }

    current.count += 1;
    return true;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const remoteAddress = req.socket.remoteAddress;
        const authHeader = req.headers.authorization;

        if (!remoteAddress) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid client address' }));
          return;
        }

        if (!this.isAllowed(remoteAddress)) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil(this.rateLimitWindowMs / 1000),
          });
          res.end(JSON.stringify({ error: 'Too Many Requests' }));
          return;
        }

        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        if (req.method === 'GET' && req.url === '/status') {
          try {
            const response = await this.mcpServer.handleJsonRpcRequest(
              { jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'novaguard.get_status', arguments: {} } },
              authHeader,
              remoteAddress
            );
            const httpStatus = response.error ? 401 : 200;
            res.writeHead(httpStatus, {
              'Content-Type': 'application/json',
              'X-MCP-Version': '2026-07-28',
            });
            res.end(JSON.stringify(response));
          } catch {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service Unavailable' }));
          }
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          let bodyBytes = 0;
          let rejected = false;

          req.setTimeout(this.requestTimeoutMs, () => {
            rejected = true;
            res.writeHead(408, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request Timeout' }));
            req.destroy();
          });

          req.on('data', (chunk: Buffer | string) => {
            if (rejected) return;
            const bytes = Buffer.byteLength(chunk);
            bodyBytes += bytes;
            if (bodyBytes > this.maxBodyBytes) {
              rejected = true;
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Request Entity Too Large' }));
              req.destroy();
              return;
            }
            body += chunk.toString();
          });

          req.on('end', async () => {
            if (rejected) return;
            try {
              if (!req.headers['content-type']?.toLowerCase().includes('application/json')) {
                res.writeHead(415, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
                return;
              }

              const jsonRpcReq = JSON.parse(body);
              const response = await this.mcpServer.handleJsonRpcRequest(
                jsonRpcReq,
                authHeader,
                remoteAddress
              );

              const httpStatus = response.error
                ? response.error.data?.mcpErrorCode === 'NOVAGUARD_AUTH_REQUIRED'
                  ? 401
                  : response.error.data?.mcpErrorCode === 'NOVAGUARD_AUTH_FORBIDDEN'
                  ? 403
                  : response.error.data?.mcpErrorCode === 'NOVAGUARD_NOT_FOUND'
                  ? 404
                  : response.error.data?.mcpErrorCode === 'NOVAGUARD_INVALID_ARGUMENT'
                  ? 400
                  : 500
                : 200;

              res.writeHead(httpStatus, {
                'Content-Type': 'application/json',
                'X-MCP-Version': '2026-07-28',
              });
              res.end(JSON.stringify(response));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: {
                    code: -32700,
                    message: 'Parse error',
                  },
                })
              );
            }
          });
          return;
        }

        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      });

      this.server.requestTimeout = this.requestTimeoutMs;
      this.server.headersTimeout = Math.max(this.requestTimeoutMs + 5_000, 35_000);
      this.server.keepAliveTimeout = 5_000;

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.requestCounts.clear();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
