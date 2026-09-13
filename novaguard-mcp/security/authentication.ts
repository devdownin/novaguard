import { createHash, timingSafeEqual } from 'crypto';
import { McpError } from '../types';

export const MCP_SCOPES = [
  // The umbrella scope `mcp.md` §13 calls the preferred one. It belongs in this
  // list because `defaultLoopbackScopes` and the bearer-token path both grant
  // `MCP_SCOPES` wholesale, while `get_status`, `get_storage` and
  // `novaguard://status` require the umbrella and nothing else. Leaving it out
  // made those three unreachable for every principal, loopback included: no
  // scope set a caller could hold satisfied them.
  'novaguard:read',
  'novaguard:status',
  'novaguard:events',
  'novaguard:statistics',
  'novaguard:configuration',
  'novaguard:media',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * The peer address a stdio transport reports.
 *
 * Stdio has no socket and therefore no peer to read an address from, but it is
 * local by construction: the pipe's other end is a process this device already
 * started. `authenticate` refuses to infer that from an absent address — a
 * transport that cannot name its peer proves nothing — so the stdio runner
 * states it. Without this every stdio call, `tools/list` included, failed with
 * NOVAGUARD_AUTH_REQUIRED.
 */
export const STDIO_PEER_ADDRESS = '127.0.0.1';

export interface SecurityContext {
  principal: string;
  scopes: string[];
  isLoopback: boolean;
  expiresAt?: number;
}

export interface AuthOptions {
  requireAuthForNonLoopback?: boolean;
  expectedToken?: string;
  expectedTokenExpiresAt?: number;
  defaultLoopbackScopes?: string[];
  tokenTtlMs?: number;
}

/** SHA-256 of a token, so nothing here holds the credential itself. */
function digestOf(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Compares two digests without leaking how far they matched.
 *
 * `a === b` on the tokens returns as soon as two bytes differ, so the time it
 * takes is a function of the shared prefix — a caller who can measure it
 * recovers the token one byte at a time. Digests are the right thing to
 * compare: always 32 bytes, so `timingSafeEqual` never throws on a length
 * mismatch, and a length mismatch is itself something the plain comparison
 * would have revealed immediately.
 */
function digestsMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export class Authenticator {
  private requireAuthForNonLoopback: boolean;
  /**
   * Registered tokens, keyed by the hex digest of the token.
   *
   * Keyed by digest rather than by the token so the process never holds a
   * credential it could log, serialise into a heap dump, or echo back.
   */
  private validTokens: Map<string, SecurityContext>;
  private expectedTokenDigest?: Buffer;
  private expectedTokenExpiresAt?: number;
  private defaultLoopbackScopes: string[];
  private tokenTtlMs: number;

  constructor(options: AuthOptions = {}) {
    this.requireAuthForNonLoopback = options.requireAuthForNonLoopback ?? true;
    this.validTokens = new Map();
    this.expectedTokenDigest = options.expectedToken ? digestOf(options.expectedToken) : undefined;
    this.expectedTokenExpiresAt = options.expectedTokenExpiresAt;
    this.defaultLoopbackScopes = options.defaultLoopbackScopes || [...MCP_SCOPES];
    this.tokenTtlMs = options.tokenTtlMs ?? 24 * 60 * 60 * 1000;
  }

  public setExpectedToken(token: string | undefined, expiresAt?: number) {
    this.expectedTokenDigest = token ? digestOf(token) : undefined;
    this.expectedTokenExpiresAt = expiresAt;
  }

  public registerToken(token: string, context: SecurityContext, ttlMs = this.tokenTtlMs) {
    if (!token || token.trim().length < 16) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Token must contain at least 16 characters', 400);
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Token TTL must be a positive number', 400);
    }
    const expiresAt = Date.now() + ttlMs;
    this.validTokens.set(digestOf(token).toString('hex'), {
      ...context,
      scopes: [...new Set(context.scopes)],
      expiresAt,
    });
  }

  public revokeToken(token: string): boolean {
    return this.validTokens.delete(digestOf(token).toString('hex'));
  }

  /**
   * A missing `remoteAddress` is deliberately NOT loopback: a transport that
   * cannot name its peer has not proven the peer is local. Transports that are
   * local by construction say so — see STDIO_PEER_ADDRESS.
   */
  public authenticate(authHeader: string | undefined, remoteAddress?: string): SecurityContext {
    const isLoopback =
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1';

    let token: string | undefined;
    if (authHeader) {
      token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : authHeader.trim();
    }

    if (token) {
      const presented = digestOf(token);
      const key = presented.toString('hex');
      const ctx = this.validTokens.get(key);
      if (ctx) {
        if (ctx.expiresAt !== undefined && ctx.expiresAt <= Date.now()) {
          this.validTokens.delete(key);
        } else {
          return {
            ...ctx,
            scopes: [...new Set(ctx.scopes)],
            isLoopback,
          };
        }
      }

      if (this.expectedTokenDigest && digestsMatch(presented, this.expectedTokenDigest)) {
        if (!this.expectedTokenExpiresAt || this.expectedTokenExpiresAt > Date.now()) {
          return {
            principal: 'mcp-bearer-user',
            scopes: [...MCP_SCOPES],
            isLoopback,
            expiresAt: this.expectedTokenExpiresAt,
          };
        }
      }
    }

    if (!isLoopback && this.requireAuthForNonLoopback) {
      throw new McpError(
        'NOVAGUARD_AUTH_REQUIRED',
        'Authentication token is required for non-loopback connections',
        401
      );
    }

    return {
      principal: isLoopback ? 'loopback-user' : 'anonymous',
      scopes: isLoopback ? [...this.defaultLoopbackScopes] : [],
      isLoopback,
    };
  }
}
