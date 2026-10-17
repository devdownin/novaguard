import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { createRelay } from '../src/relay.js';
import { authenticate, deviceIdFor, route, SIGNED_PREFIX } from '../src/protocol.js';

const rawKey = publicKey => publicKey.export({ format: 'der', type: 'spki' });
const newKeyPair = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const signNonce = (nonce, privateKey) => sign('sha256', Buffer.from(SIGNED_PREFIX + nonce), privateKey).toString('base64url');

/** A phone: dials in, signs the challenge, and answers requests with `answer`. */
async function phone(base, answer, { signWith } = {}) {
  const { publicKey, privateKey } = newKeyPair();
  const key = rawKey(publicKey);
  const ws = new WebSocket(`${base.replace('http', 'ws')}/connect`);
  const seen = [];
  const closed = new Promise(resolve => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  const ready = new Promise((resolve, reject) => {
    ws.on('message', async data => {
      const frame = JSON.parse(data.toString());
      if (frame.t === 'challenge') {
        const signer = signWith ?? privateKey;
        const sig = signNonce(frame.nonce, signer);
        ws.send(JSON.stringify({ t: 'hello', key: key.toString('base64url'), sig }));
      } else if (frame.t === 'ready') {
        resolve(frame);
      } else if (frame.t === 'req') {
        seen.push(frame);
        const reply = await answer(frame);
        if (reply) ws.send(JSON.stringify({ t: 'res', id: frame.id, ...reply }));
      }
    });
    closed.then(reject);
  });
  return { ws, ready, closed, seen, id: deviceIdFor(key) };
}

const ok = body => () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body).toString('base64') });

describe('protocol', () => {
  it('derives a 26-character id from the key, and nothing else', () => {
    const { publicKey } = newKeyPair();
    const id = deviceIdFor(rawKey(publicKey));
    assert.match(id, /^[a-z2-7]{26}$/);
    assert.equal(id, deviceIdFor(rawKey(publicKey)));
  });

  it('routes a public path to the device and the path the phone sees', () => {
    const id = 'a'.repeat(26);
    assert.deepEqual(route(`/d/${id}/mcp`), { id, path: '/mcp' });
    assert.deepEqual(route(`/d/${id}/mcp?x=1`), { id, path: '/mcp?x=1' });
    assert.deepEqual(route(`/.well-known/oauth-protected-resource/d/${id}/mcp`), {
      id, path: '/.well-known/oauth-protected-resource/mcp',
    });
    assert.deepEqual(route(`/.well-known/oauth-authorization-server/d/${id}`), {
      id, path: '/.well-known/oauth-authorization-server',
    }, 'issuer metadata has no trailing path');
    assert.deepEqual(route(`/d/${id}/authorize?state=x`), { id, path: '/authorize?state=x' });
    assert.deepEqual(route(`/d/${id}`), { id, path: '/' });
    assert.equal(route('/d/short/mcp'), null);
    assert.equal(route(`/x/d/${id}/mcp`), null);
    assert.equal(route(`/d/${id}/../../etc`)?.path, '/../../etc');
  });

  it('refuses a signature made over another nonce', () => {
    const { publicKey, privateKey } = newKeyPair();
    const key = rawKey(publicKey).toString('base64url');
    const sig = sign(null, Buffer.from(`${SIGNED_PREFIX}one`), privateKey).toString('base64url');
    assert.ok(authenticate(key, sig, 'one'));
    assert.equal(authenticate(key, sig, 'two'), null);
    assert.equal(authenticate(key, 'AAAA', 'one'), null);
    assert.equal(authenticate('short', sig, 'one'), null);
    const other = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const wrongCurve = rawKey(other.publicKey).toString('base64url');
    assert.equal(authenticate(wrongCurve, signNonce('one', other.privateKey), 'one'), null, 'only P-256 is accepted');
    const ed = generateKeyPairSync('ed25519');
    assert.equal(authenticate(rawKey(ed.publicKey).toString('base64url'), sign(null, Buffer.from(`${SIGNED_PREFIX}one`), ed.privateKey).toString('base64url'), 'one'), null, 'and no other algorithm');
    assert.equal(authenticate(undefined, undefined, 'one'), null);
  });
});

describe('relay', () => {
  let relay, base, logs;
  before(async () => {
    logs = [];
    relay = createRelay({ log: entry => logs.push(entry), limits: { requestsPerMinute: 5, requestTimeoutMs: 300, inFlight: 2, responseBodyBytes: 1024 } });
    await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${relay.server.address().port}`;
  });
  after(() => relay.close());

  const call = (id, init = {}, path = '/mcp') => fetch(`${base}/d/${id}${path}`, { method: 'POST', ...init });

  it('carries a request to the phone and its answer back', async () => {
    const p = await phone(base, ok('{"result":1}'));
    const { path } = await p.ready;
    assert.equal(path, `/d/${p.id}/mcp`);

    const res = await call(p.id, { headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: '{"a":1}' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"result":1}');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(p.seen[0].method, 'POST');
    assert.equal(p.seen[0].path, '/mcp');
    assert.equal(Buffer.from(p.seen[0].body, 'base64').toString(), '{"a":1}');
    assert.equal(p.seen[0].headers.authorization, 'Bearer t');
    p.ws.close();
  });

  it('passes the consent page its security headers back, and drops the rest', async () => {
    const p = await phone(base, () => ({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'", 'referrer-policy': 'no-referrer', 'set-cookie': 'a=b', location: 'https://evil.example' },
      body: Buffer.from('<p>ok</p>').toString('base64'),
    }));
    await p.ready;
    const res = await fetch(`${base}/d/${p.id}/authorize?x=1`);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('location'), null);
    assert.equal(p.seen[0].method, 'GET');
    assert.equal(p.seen[0].path, '/authorize?x=1');
    p.ws.close();
  });

  it('hands the phone only the headers it needs', async () => {
    const p = await phone(base, ok('{}'));
    await p.ready;
    await call(p.id, { headers: { cookie: 'a=b', 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4', 'content-type': 'application/json' }, body: '{}' });
    assert.deepEqual(Object.keys(p.seen[0].headers).sort(), ['accept', 'content-type']);
    assert.equal(p.seen[0].headers.cookie, undefined);
    p.ws.close();
  });

  it('never puts a path, header or body in its log', async () => {
    const p = await phone(base, ok('{"secret":"image"}'));
    await p.ready;
    await call(p.id, { headers: { authorization: 'Bearer hunter2' }, body: '{"private":"frame"}' });
    const text = JSON.stringify(logs);
    assert.ok(!text.includes('hunter2') && !text.includes('private') && !text.includes('secret') && !text.includes('/mcp'));
    assert.ok(logs.some(entry => entry.id === p.id && entry.status === 200 && entry.method === 'POST'));
    p.ws.close();
  });

  it('answers 503 for a phone that is not connected, and 404 for what is not a device path', async () => {
    assert.equal((await call('b'.repeat(26))).status, 503);
    assert.equal((await fetch(`${base}/anything`)).status, 404);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });

  it('refuses a phone that cannot sign the challenge', async () => {
    const stranger = newKeyPair().privateKey;
    const p = await phone(base, ok('{}'), { signWith: stranger });
    p.ready.catch(() => {});
    const { code } = await p.closed;
    assert.equal(code, 4003);
  });

  it('keeps one connection per phone: the newer replaces the older', async () => {
    const { publicKey, privateKey } = newKeyPair();
    const dial = () => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/connect`);
      const closed = new Promise(resolve => ws.once('close', code => resolve(code)));
      ws.on('message', data => {
        const frame = JSON.parse(data.toString());
        if (frame.t === 'challenge') {
          const sig = signNonce(frame.nonce, privateKey);
          ws.send(JSON.stringify({ t: 'hello', key: rawKey(publicKey).toString('base64url'), sig }));
        }
      });
      return { ws, closed, ready: new Promise(resolve => ws.on('message', d => JSON.parse(d.toString()).t === 'ready' && resolve())) };
    };
    const first = dial();
    await first.ready;
    const second = dial();
    await second.ready;
    assert.equal(await first.closed, 4000);
    assert.equal(relay.devices.size >= 1, true);
    second.ws.close();
  });

  it('fails a pending request with 502 when the phone drops', async () => {
    const p = await phone(base, () => null);
    await p.ready;
    const pending = call(p.id, { body: '{}' });
    await new Promise(resolve => setTimeout(resolve, 50));
    p.ws.terminate();
    assert.equal((await pending).status, 502);
  });

  it('gives up on a phone that never answers: 504', async () => {
    const p = await phone(base, () => null);
    await p.ready;
    assert.equal((await call(p.id, { body: '{}' })).status, 504);
    p.ws.close();
  });

  it('refuses a request body over the limit before the phone sees it', async () => {
    const p = await phone(base, ok('{}'));
    await p.ready;
    const res = await call(p.id, { body: 'x'.repeat(300 * 1024) }).catch(() => ({ status: 413 }));
    assert.equal(res.status, 413);
    assert.equal(p.seen.length, 0);
    p.ws.close();
  });

  it('turns an oversized answer into 502 instead of passing it on', async () => {
    const p = await phone(base, () => ({ status: 200, body: Buffer.alloc(2048).toString('base64') }));
    await p.ready;
    assert.equal((await call(p.id, { body: '{}' })).status, 502);
    p.ws.close();
  });

  it('refuses an answer that claims a status it should not', async () => {
    const p = await phone(base, () => ({ status: 101, body: '' }));
    await p.ready;
    assert.equal((await call(p.id, { body: '{}' })).status, 502);
    p.ws.close();
  });

  it('limits requests per minute and in flight, per phone', async () => {
    const slow = await phone(base, () => null);
    await slow.ready;
    const flight = [call(slow.id, { body: '{}' }), call(slow.id, { body: '{}' })];
    await new Promise(resolve => setTimeout(resolve, 50));
    const third = await call(slow.id, { body: '{}' });
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '60');
    await Promise.all(flight);
    slow.ws.close();

    const fast = await phone(base, ok('{}'));
    await fast.ready;
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await call(fast.id, { body: '{}' })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
    fast.ws.close();
  });
});
