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
      this.requestCounts.set(remoteAddress, { count: 1, resetAt: now + this.rateLimitWindowMs });
      return true;
    }
    if (current.count >= this.maxRequestsPerWindow) return false;
    current.count += 1;
    return true;
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    return origin === `http://127.0.0.1:${this.port}` ||
      origin === `http://localhost:${this.port}` ||
      origin === `http://[::1]:${this.port}`;
  }

  private writeJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
    res.end(JSON.stringify(body));
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const remoteAddress = req.socket.remoteAddress;
        const authHeader = req.headers.authorization;

        if (!remoteAddress) {
          this.writeJson(res, 400, { error: 'Invalid client address' });
          return;
        }

        if (!this.isAllowedOrigin(req.headers.origin)) {
          this.writeJson(res, 403, { error: 'Forbidden origin' });
          return;
        }

        if (!this.isAllowed(remoteAddress)) {
          this.writeJson(res, 429, { error: 'Too Many Requests' }, {
            'Retry-After': String(Math.ceil(this.rateLimitWindowMs / 1000)),
          });
          return;
        }

        if (req.method === 'GET' && req.url === '/health') {
          this.writeJson(res, 200, { status: 'ok' });
          return;
        }

        if (req.method === 'GET' && req.url === '/status') {
          const response = await this.mcpServer.handleJsonRpcRequest(
            { jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'novaguard.get_status', arguments: {} } },
            authHeader,
            remoteAddress
          );
          const errorCode = response.error?.data?.mcpErrorCode;
          const httpStatus = !response.error ? 200 :
            errorCode === 'NOVAGUARD_AUTH_REQUIRED' ? 401 :
            errorCode === 'NOVAGUARD_AUTH_FORBIDDEN' ? 403 : 500;
          this.writeJson(res, httpStatus, response, { 'X-MCP-Version': '2026-07-28' });
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          let bodyBytes = 0;
          let rejected = false;

          req.setTimeout(this.requestTimeoutMs, () => {
            rejected = true;
            this.writeJson(res, 408, { error: 'Request Timeout' });
            req.destroy();
          });

          req.on('data', (chunk: Buffer | string) => {
            if (rejected) return;
            bodyBytes += Buffer.byteLength(chunk);
            if (bodyBytes > this.maxBodyBytes) {
              rejected = true;
              this.writeJson(res, 413, { error: 'Request Entity Too Large' });
              req.destroy();
              return;
            }
            body += chunk.toString();
          });

          req.on('end', async () => {
            if (rejected) return;
            try {
              if (!req.headers['content-type']?.toLowerCase().includes('application/json')) {
                this.writeJson(res, 415, { error: 'Content-Type must be application/json' });
                return;
              }

              const jsonRpcReq = JSON.parse(body);
              const response = await this.mcpServer.handleJsonRpcRequest(jsonRpcReq, authHeader, remoteAddress);
              const errorCode = response.error?.data?.mcpErrorCode;
              const httpStatus = !response.error ? 200 :
                errorCode === 'NOVAGUARD_AUTH_REQUIRED' ? 401 :
                errorCode === 'NOVAGUARD_AUTH_FORBIDDEN' ? 403 :
                errorCode === 'NOVAGUARD_NOT_FOUND' ? 404 :
                errorCode === 'NOVAGUARD_INVALID_ARGUMENT' ? 400 :
                errorCode === 'NOVAGUARD_MEDIA_TOO_LARGE' ? 413 : 500;

              this.writeJson(res, httpStatus, response, { 'X-MCP-Version': '2026-07-28' });
            } catch {
              this.writeJson(res, 400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
              });
            }
          });
          return;
        }

        this.writeJson(res, 405, { error: 'Method Not Allowed' });
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
