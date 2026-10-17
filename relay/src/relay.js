import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  authenticate, decode, DEVICE_ID_PATTERN, LIMITS, newNonce, requestHeaders, responseHeaders, route,
} from './protocol.js';

/**
 * Forwards HTTP requests from cloud MCP clients to the phone that dialled in.
 *
 * It keeps nothing: a request lives in memory until the phone answers, and the
 * only record is a log line with the time, device, method, status, size and
 * duration — never a path, a header or a byte of a body. TLS ends here (it
 * sits behind the project's terminator), so the relay can read what passes;
 * `docs/CONNEXION.md` §14.4 says so to the owner before the feature is on.
 */
export function createRelay({ log = () => {}, limits = {}, now = () => Date.now() } = {}) {
  const cfg = { ...LIMITS, ...limits };
  /** @type {Map<string, Device>} */
  const devices = new Map();

  const server = createServer((req, res) => handle(req, res));
  const sockets = new WebSocketServer({ noServer: true, maxPayload: cfg.framePayloadBytes });

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/connect') return socket.destroy();
    sockets.handleUpgrade(req, socket, head, ws => accept(ws));
  });

  function accept(ws) {
    const nonce = newNonce();
    const timer = setTimeout(() => ws.close(4001, 'handshake timeout'), cfg.handshakeTimeoutMs);
    ws.send(JSON.stringify({ t: 'challenge', nonce }));
    ws.once('message', data => {
      clearTimeout(timer);
      const hello = decode(data);
      const id = hello?.t === 'hello' ? authenticate(hello.key, hello.sig, nonce) : null;
      if (!id) return ws.close(4003, 'unauthorized');
      attach(id, ws);
    });
    ws.once('close', () => clearTimeout(timer));
    ws.on('error', () => {});
  }

  function attach(id, ws) {
    // One connection per phone: a reconnect after a network change must win over
    // the half-open socket the relay has not noticed is dead.
    devices.get(id)?.close(4000, 'replaced');
    const device = new Device(id, ws, cfg);
    devices.set(id, device);
    ws.send(JSON.stringify({ t: 'ready', id, path: `/d/${id}/mcp` }));
    ws.on('message', data => device.receive(decode(data)));
    ws.on('pong', () => { device.alive = true; });
    ws.on('close', () => {
      device.fail(502);
      if (devices.get(id) === device) devices.delete(id);
    });
    log({ ts: now(), id, event: 'connected' });
  }

  async function handle(req, res) {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { 'content-type': 'application/json' }, '{"status":"ok"}');
    const target = route(req.url ?? '');
    if (!target) return send(res, 404, {}, '');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return send(res, 405, {}, '');
    const started = now();
    const done = (status, bytes = 0) => log({ ts: started, id: target.id, method: req.method, status, bytes, ms: now() - started });

    const device = devices.get(target.id);
    if (!device) { done(503); return send(res, 503, { 'retry-after': '30' }, ''); }
    if (!device.admit(now())) { done(429); return send(res, 429, { 'retry-after': '60' }, ''); }

    const body = await readBody(req, cfg.requestBodyBytes);
    if (body === null) { done(413); return send(res, 413, {}, ''); }

    const reply = await device.forward({
      method: req.method, path: target.path, headers: requestHeaders(req.headers), body: body.toString('base64'),
    });
    done(reply.status, reply.body.length);
    send(res, reply.status, reply.headers, reply.body);
  }

  const heartbeat = setInterval(() => {
    for (const device of devices.values()) device.ping();
  }, cfg.pingIntervalMs);
  heartbeat.unref();

  return {
    server,
    devices,
    close: () => new Promise(resolve => {
      clearInterval(heartbeat);
      for (const device of devices.values()) device.close(1001, 'shutdown');
      sockets.close();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

class Device {
  constructor(id, ws, cfg) {
    this.id = id;
    this.ws = ws;
    this.cfg = cfg;
    this.alive = true;
    this.window = { count: 0, resetAt: 0 };
    this.nextId = 0;
    /** @type {Map<string, {resolve: Function, timer: NodeJS.Timeout}>} */
    this.pending = new Map();
  }

  admit(now) {
    if (this.pending.size >= this.cfg.inFlight) return false;
    if (now >= this.window.resetAt) this.window = { count: 0, resetAt: now + 60_000 };
    return ++this.window.count <= this.cfg.requestsPerMinute;
  }

  forward(request) {
    return new Promise(resolve => {
      const id = String(++this.nextId);
      const timer = setTimeout(() => this.settle(id, 504), this.cfg.requestTimeoutMs);
      this.pending.set(id, { resolve, timer });
      this.ws.send(JSON.stringify({ t: 'req', id, ...request }), error => { if (error) this.settle(id, 502); });
    });
  }

  receive(frame) {
    if (frame?.t !== 'res' || !this.pending.has(frame.id)) return;
    const status = Number.isInteger(frame.status) && frame.status >= 200 && frame.status <= 599 ? frame.status : 502;
    const body = typeof frame.body === 'string' ? Buffer.from(frame.body, 'base64') : Buffer.alloc(0);
    if (body.length > this.cfg.responseBodyBytes) return this.settle(frame.id, 502);
    const { resolve, timer } = this.pending.get(frame.id);
    clearTimeout(timer);
    this.pending.delete(frame.id);
    resolve({ status, headers: responseHeaders(frame.headers), body });
  }

  settle(id, status) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve({ status, headers: {}, body: Buffer.alloc(0) });
  }

  fail(status) {
    for (const id of [...this.pending.keys()]) this.settle(id, status);
  }

  ping() {
    if (!this.alive) return this.ws.terminate();
    this.alive = false;
    try { this.ws.ping(); } catch { this.ws.terminate(); }
  }

  close(code, reason) {
    try { this.ws.close(code, reason); } catch { /* already gone */ }
  }
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { req.destroy(); return null; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, headers, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    'x-content-type-options': 'nosniff',
    ...headers,
    'content-length': bytes.length,
    connection: 'close',
  });
  res.end(bytes);
}

export { DEVICE_ID_PATTERN };
