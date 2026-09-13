import * as http from 'http';
import { NovaGuardMcpServer } from '../server';
import { LATEST_PROTOCOL_VERSION } from '../protocol';

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

/**
 * Ceiling on the rate-limit table. Reached only by a caller varying its source
 * address, which is the case the cap exists for.
 */
const MAX_RATE_LIMIT_ENTRIES = 1_024;

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

  /**
   * Rate limit, with the window table kept bounded.
   *
   * One entry per peer that ever connected, purged only on `stop()`, is a slow
   * leak on a server meant to run for weeks — and a fast one for anything that
   * can vary its source address. Expired windows are swept whenever the table
   * grows past its cap, and if a sweep frees nothing the oldest entries go:
   * forgetting a window is a caller getting a fresh allowance, which is the
   * safe direction to fail when the alternative is unbounded memory.
   */
  private isAllowed(remoteAddress: string): boolean {
    const now = Date.now();
    if (this.requestCounts.size >= MAX_RATE_LIMIT_ENTRIES) this.evictRateLimitEntries(now);

    const current = this.requestCounts.get(remoteAddress);
    if (!current || current.resetAt <= now) {
      this.requestCounts.set(remoteAddress, { count: 1, resetAt: now + this.rateLimitWindowMs });
      return true;
    }
    if (current.count >= this.maxRequestsPerWindow) return false;
    current.count += 1;
    return true;
  }

  private evictRateLimitEntries(now: number): void {
    for (const [address, window] of this.requestCounts) {
      if (window.resetAt <= now) this.requestCounts.delete(address);
    }
    // Map iterates in insertion order, so this drops the least recently
    // created windows first.
    for (const address of this.requestCounts.keys()) {
      if (this.requestCounts.size <= MAX_RATE_LIMIT_ENTRIES / 2) break;
      this.requestCounts.delete(address);
    }
  }

  /**
   * Refuses a request a browser made on some other site's behalf.
   *
   * `Origin` is only sent by browsers, so an absent one is an ordinary MCP
   * client and is allowed — which is why `Host` is checked too. Together they
   * are the DNS-rebinding defence the transport guidance asks for: a page on
   * `evil.example` whose name has been pointed at this device reaches the
   * socket, but arrives carrying either a foreign `Origin` or a `Host` that is
   * not one this server answers to.
   */
  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    return this.expectedAuthorities().some(authority => origin === `http://${authority}`);
  }

  private isAllowedHost(host: string | undefined): boolean {
    // HTTP/1.1 requires a Host; refusing a request without one costs nothing
    // and removes the "header absent" branch from the check below.
    if (!host) return false;
    return this.expectedAuthorities().includes(host.toLowerCase());
  }

  private expectedAuthorities(): string[] {
    return [
      `127.0.0.1:${this.port}`,
      `localhost:${this.port}`,
      `[::1]:${this.port}`,
      `${this.host}:${this.port}`,
    ];
  }

  /**
   * A 401 has to say how to authenticate.
   *
   * Without `WWW-Authenticate` a client is told it is unauthorised and nothing
   * about what would fix it: the MCP authorization spec builds its whole
   * discovery flow on this header, so omitting it leaves a conforming client
   * with a dead end rather than a scheme to satisfy.
   */
  private responseHeaders(status: number): Record<string, string> {
    const headers: Record<string, string> = { 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION };
    if (status === 401) headers['WWW-Authenticate'] = 'Bearer realm="NovaGuard MCP"';
    return headers;
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

        if (!this.isAllowedHost(req.headers.host)) {
          this.writeJson(res, 421, { error: 'Misdirected Request' });
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
          const errorCode = response?.error?.data?.mcpErrorCode;
          const httpStatus = !response?.error ? 200 :
            errorCode === 'NOVAGUARD_AUTH_REQUIRED' ? 401 :
            errorCode === 'NOVAGUARD_AUTH_FORBIDDEN' ? 403 : 500;
          this.writeJson(res, httpStatus, response, this.responseHeaders(httpStatus));
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
              // A notification is acknowledged with no body. Answering one
              // desynchronises a conforming client, and `202 Accepted` is what
              // the Streamable HTTP transport specifies for it.
              if (!response) {
                res.writeHead(202, { 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION });
                res.end();
                return;
              }
              const errorCode = response.error?.data?.mcpErrorCode;
              const httpStatus = !response.error ? 200 :
                errorCode === 'NOVAGUARD_AUTH_REQUIRED' ? 401 :
                errorCode === 'NOVAGUARD_AUTH_FORBIDDEN' ? 403 :
                errorCode === 'NOVAGUARD_NOT_FOUND' ? 404 :
                errorCode === 'NOVAGUARD_INVALID_ARGUMENT' ? 400 :
                errorCode === 'NOVAGUARD_MEDIA_TOO_LARGE' ? 413 : 500;

              this.writeJson(res, httpStatus, response, this.responseHeaders(httpStatus));
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
