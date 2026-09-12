import * as http from 'http';
import { NovaGuardMcpServer } from '../server';

export interface HttpServerOptions {
  port?: number;
  host?: string;
  server?: NovaGuardMcpServer;
}

export class McpHttpServer {
  public readonly port: number;
  public readonly host: string;
  public readonly mcpServer: NovaGuardMcpServer;
  private server: http.Server | null = null;

  constructor(options: HttpServerOptions = {}) {
    this.port = options.port || 8081;
    this.host = options.host || '127.0.0.1';
    this.mcpServer = options.server || new NovaGuardMcpServer();
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const remoteAddress = req.socket.remoteAddress || '127.0.0.1';
        const authHeader = req.headers.authorization;

        if (req.method === 'GET' && (req.url === '/health' || req.url === '/status')) {
          try {
            const status = await this.mcpServer.client.getStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
          } catch (err: any) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service Unavailable', message: err.message }));
          }
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });

          req.on('end', async () => {
            try {
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
                  : 400
                : 200;

              res.writeHead(httpStatus, {
                'Content-Type': 'application/json',
                'X-MCP-Version': '2026-07-28',
              });
              res.end(JSON.stringify(response));
            } catch (err: any) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: {
                    code: -32700,
                    message: `Parse error: ${err.message}`,
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

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
