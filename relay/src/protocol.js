import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

/** What the phone signs: the label keeps a signature from being replayed in another protocol. */
export const SIGNED_PREFIX = 'novaguard-relay-v1\n';

/** Limits shared by the relay and the tests; the phone's own are 256 KiB in, 20 MiB out. */
export const LIMITS = {
  requestBodyBytes: 256 * 1024,
  responseBodyBytes: 8 * 1024 * 1024,
  // base64 of the largest body, plus the JSON around it.
  framePayloadBytes: 12 * 1024 * 1024,
  requestsPerMinute: 120,
  inFlight: 8,
  requestTimeoutMs: 30_000,
  handshakeTimeoutMs: 10_000,
  pingIntervalMs: 20_000,
};

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/* eslint-disable no-bitwise -- bit packing is the whole function */
function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
/* eslint-enable no-bitwise */

/**
 * The public identifier of a phone: a hash of its key, not something it picks.
 * Nobody can claim another phone's address without that phone's private key,
 * which is why the relay needs no registry and no pairing code.
 */
export function deviceIdFor(rawKey) {
  return base32(createHash('sha256').update(rawKey).digest().subarray(0, 16));
}

export const DEVICE_ID_PATTERN = /^[a-z2-7]{26}$/;

export function newNonce() {
  return randomBytes(32).toString('base64url');
}

/** Null unless `key` is a base64url Ed25519 public key and `signature` signs `nonce` with it. */
export function authenticate(key, signature, nonce) {
  if (typeof key !== 'string' || typeof signature !== 'string') return null;
  const raw = Buffer.from(key, 'base64url');
  if (raw.length !== 32) return null;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
    const ok = verify(null, Buffer.from(SIGNED_PREFIX + nonce), publicKey, Buffer.from(signature, 'base64url'));
    return ok ? deviceIdFor(raw) : null;
  } catch {
    return null;
  }
}

// Headers a caller may hand the phone. Everything else — cookies, forwarding
// headers, anything the relay's own proxy added — stops here.
const REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'origin'];
const RESPONSE_HEADERS = ['content-type', 'www-authenticate', 'mcp-protocol-version', 'retry-after', 'cache-control'];

function pick(source, names) {
  const out = {};
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string' && value.length <= 4096) out[name] = value;
  }
  return out;
}

export const requestHeaders = headers => pick(headers, REQUEST_HEADERS);

export function responseHeaders(headers) {
  const out = pick(typeof headers === 'object' && headers ? lowercaseKeys(headers) : {}, RESPONSE_HEADERS);
  out['cache-control'] ??= 'no-store';
  return out;
}

function lowercaseKeys(object) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k.toLowerCase(), v]));
}

const ROUTE = /^(\/\.well-known\/[A-Za-z0-9._-]+)?\/d\/([a-z2-7]{26})(\/[^?]*)?(\?.*)?$/;

/**
 * Splits a public URL into the device it is for and the path the phone sees.
 * `/d/<id>/mcp` reaches the phone as `/mcp`; the OAuth metadata documents, whose
 * well-known prefix comes first by RFC 9728, keep it: `/.well-known/x/d/<id>/mcp`
 * reaches the phone as `/.well-known/x/mcp`.
 */
export function route(url) {
  const match = ROUTE.exec(url);
  if (!match) return null;
  const [, wellKnown = '', id, rest = '', query = ''] = match;
  return { id, path: `${wellKnown}${rest || '/'}${query}` };
}

export const decode = data => {
  try {
    const frame = JSON.parse(data.toString('utf8'));
    return frame && typeof frame === 'object' && typeof frame.t === 'string' ? frame : null;
  } catch {
    return null;
  }
};
