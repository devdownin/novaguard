import dns from 'dns/promises';
import net from 'net';
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
const MAX_REDIRECTS = 3;

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((value, part) => ((value * 256) + Number(part)) >>> 0, 0);
}

function ipv6ToBigInt(ip: string): bigint {
  const normalized = ip.toLowerCase().split('%')[0];
  const halves = normalized.split('::');
  if (halves.length > 2) throw new Error('Invalid IPv6 address');
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const expand = (parts: string[]) => {
    const out: number[] = [];
    for (const part of parts) {
      if (part.includes('.')) {
        const n = ipv4ToNumber(part);
        out.push((n >>> 16) & 0xffff, n & 0xffff);
      } else {
        const n = Number.parseInt(part, 16);
        if (!Number.isFinite(n) || n < 0 || n > 0xffff) throw new Error('Invalid IPv6 address');
        out.push(n);
      }
    }
    return out;
  };
  const words = expand(left);
  const rightWords = expand(right);
  const missing = 8 - words.length - rightWords.length;
  if (halves.length === 1 || missing < 0) {
    if (missing !== 0) throw new Error('Invalid IPv6 address');
  }
  const all = [...words, ...Array(Math.max(0, missing)).fill(0), ...rightWords];
  if (all.length !== 8) throw new Error('Invalid IPv6 address');
  return all.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const n = ipv4ToNumber(ip);
    const a = n >>> 24;
    const b = (n >>> 16) & 0xff;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && ((n >>> 8) & 0xff) === 0) ||
      (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51 && (n & 0xff) === 100) ||
      (a === 203 && b === 0 && ((n >>> 8) & 0xff) === 113) ||
      a >= 224;
  }
  if (family === 6) {
    const n = ipv6ToBigInt(ip);
    const top8 = Number(n >> 120n);
    const top10 = Number(n >> 118n);
    const top32 = Number(n >> 96n);
    const mappedV4 = top32 === 0x0000ffff ? Number(n & 0xffffffffn) : null;
    return n === 0n || n === 1n || top10 === 0b1111110000 || top10 === 0b1111111010 ||
      top8 === 0xff || Number(n >> 96n) === 0x20010db8 ||
      (mappedV4 !== null && isBlockedIp(`${mappedV4 >>> 24}.${(mappedV4 >>> 16) & 255}.${(mappedV4 >>> 8) & 255}.${mappedV4 & 255}`));
  }
  return true;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '::1' || hostname === '::ffff:127.0.0.1';
}

async function validateUpstreamUrl(rawUrl: string, expectedOrigin?: string): Promise<URL> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Invalid upstream URL', 503); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Blocked upstream URL', 503);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopbackHost = isLoopbackHost(hostname);
  // A loopback peer may listen anywhere: NovaGuard's own read API is a port
  // above 1024 on the device, never 80. Restricting every host to 80/443
  // blocked the only endpoint `validateClientEndpoint` accepts, so no request
  // could leave at all. Off-device hosts keep the restriction, where it does
  // what it was for — refusing a redirect to some other service's port.
  if (!loopbackHost && url.port && !['80', '443'].includes(url.port)) {
    throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Blocked upstream port', 503);
  }
  if (hostname === 'metadata.google.internal' || hostname === 'metadata' || hostname.endsWith('.internal')) {
    throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Blocked upstream hostname', 503);
  }
  if (net.isIP(hostname) && !loopbackHost && isBlockedIp(hostname)) {
    throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Blocked upstream IP address', 503);
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || (!loopbackHost && records.some(record => isBlockedIp(record.address)))) {
    throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Blocked upstream DNS resolution', 503);
  }
  if (expectedOrigin && url.origin !== expectedOrigin) {
    throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Cross-origin redirect blocked', 503);
  }
  return url;
}

async function secureFetch(fetchFn: typeof fetch, rawUrl: string, init: RequestInit): Promise<Response> {
  let current = await validateUpstreamUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchFn(current.toString(), { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === MAX_REDIRECTS) throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Upstream redirect rejected', 503);
    const next = new URL(location, current);
    if (next.origin !== current.origin) throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Cross-origin redirect blocked', 503);
    current = await validateUpstreamUrl(next.toString(), current.origin);
  }
  throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Too many upstream redirects', 503);
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
    this.validateClientEndpoint(this.client);
    this.authenticator = options.authenticator || new Authenticator();
    this.authorizer = options.authorizer || new Authorizer();
    this.auditLogger = options.auditLogger || new AuditLogger();
    this.maxThumbnailBytes = options.maxThumbnailBytes ?? 2 * 1024 * 1024;
    this.maxVideoBytes = options.maxVideoBytes ?? 20 * 1024 * 1024;
    const clientFetch = (this.client as any).fetchFn as typeof fetch | undefined;
    if (clientFetch) (this.client as any).fetchFn = (url: string, init: RequestInit) => secureFetch(clientFetch, url, init);
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
