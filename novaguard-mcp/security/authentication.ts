import { McpError } from '../types';

export const MCP_SCOPES = [
  'novaguard:status',
  'novaguard:events',
  'novaguard:statistics',
  'novaguard:configuration',
  'novaguard:media',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export interface SecurityContext {
  principal: string;
  scopes: string[];
  isLoopback: boolean;
  expiresAt?: number;
}

export interface AuthOptions {
  requireAuthForNonLoopback?: boolean;
  validTokens?: Map<string, SecurityContext>;
  expectedToken?: string;
  expectedTokenExpiresAt?: number;
  defaultLoopbackScopes?: string[];
  tokenTtlMs?: number;
}

export class Authenticator {
  private requireAuthForNonLoopback: boolean;
  private validTokens: Map<string, SecurityContext>;
  private expectedToken?: string;
  private expectedTokenExpiresAt?: number;
  private defaultLoopbackScopes: string[];
  private tokenTtlMs: number;

  constructor(options: AuthOptions = {}) {
    this.requireAuthForNonLoopback = options.requireAuthForNonLoopback ?? true;
    this.validTokens = options.validTokens || new Map();
    this.expectedToken = options.expectedToken;
    this.expectedTokenExpiresAt = options.expectedTokenExpiresAt;
    this.defaultLoopbackScopes = options.defaultLoopbackScopes || [...MCP_SCOPES];
    this.tokenTtlMs = options.tokenTtlMs ?? 24 * 60 * 60 * 1000;
  }

  public setExpectedToken(token: string | undefined, expiresAt?: number) {
    this.expectedToken = token;
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
    this.validTokens.set(token, {
      ...context,
      scopes: [...new Set(context.scopes)],
      expiresAt,
    });
  }

  public revokeToken(token: string): boolean {
    return this.validTokens.delete(token);
  }

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
      const ctx = this.validTokens.get(token);
      if (ctx) {
        if (ctx.expiresAt !== undefined && ctx.expiresAt <= Date.now()) {
          this.validTokens.delete(token);
        } else {
          return {
            ...ctx,
            scopes: [...new Set(ctx.scopes)],
            isLoopback,
          };
        }
      }

      if (this.expectedToken && token === this.expectedToken) {
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
