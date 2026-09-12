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
}

export interface AuthOptions {
  requireAuthForNonLoopback?: boolean;
  validTokens?: Map<string, SecurityContext>;
  expectedToken?: string;
  defaultLoopbackScopes?: string[];
}

export class Authenticator {
  private requireAuthForNonLoopback: boolean;
  private validTokens: Map<string, SecurityContext>;
  private expectedToken?: string;
  private defaultLoopbackScopes: string[];

  constructor(options: AuthOptions = {}) {
    this.requireAuthForNonLoopback = options.requireAuthForNonLoopback ?? true;
    this.validTokens = options.validTokens || new Map();
    this.expectedToken = options.expectedToken;
    this.defaultLoopbackScopes = options.defaultLoopbackScopes || [...MCP_SCOPES];
  }

  public setExpectedToken(token: string | undefined) {
    this.expectedToken = token;
  }

  public registerToken(token: string, context: SecurityContext) {
    if (!token || token.trim().length < 16) {
      throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Token must contain at least 16 characters', 400);
    }
    this.validTokens.set(token, {
      ...context,
      scopes: [...new Set(context.scopes)],
    });
  }

  public authenticate(authHeader: string | undefined, remoteAddress?: string): SecurityContext {
    const isLoopback =
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1';

    let token: string | undefined;

    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    if (token && this.validTokens.has(token)) {
      const ctx = this.validTokens.get(token)!;
      return {
        ...ctx,
        scopes: [...new Set(ctx.scopes)],
        isLoopback,
      };
    }

    if (token && this.expectedToken && token === this.expectedToken) {
      return {
        principal: 'mcp-bearer-user',
        scopes: [...MCP_SCOPES],
        isLoopback,
      };
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
