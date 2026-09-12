import { McpError } from '../types';

export interface SecurityContext {
  principal: string;
  scopes: string[];
  isLoopback: boolean;
}

export interface AuthOptions {
  requireAuthForNonLoopback?: boolean;
  validTokens?: Map<string, SecurityContext>; // token -> context
  defaultLoopbackScopes?: string[];
}

export class Authenticator {
  private requireAuthForNonLoopback: boolean;
  private validTokens: Map<string, SecurityContext>;
  private defaultLoopbackScopes: string[];

  constructor(options: AuthOptions = {}) {
    this.requireAuthForNonLoopback = options.requireAuthForNonLoopback ?? true;
    this.validTokens = options.validTokens || new Map();
    this.defaultLoopbackScopes = options.defaultLoopbackScopes || ['novaguard:read'];
  }

  public registerToken(token: string, context: SecurityContext) {
    this.validTokens.set(token, context);
  }

  public authenticate(authHeader: string | undefined, remoteAddress?: string): SecurityContext {
    const isLoopback =
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === 'localhost' ||
      !remoteAddress; // Default to loopback if omitted in local calls

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

    // Loopback fallback or unauthenticated allowed loopback context
    return {
      principal: isLoopback ? 'loopback-user' : 'anonymous',
      scopes: isLoopback ? this.defaultLoopbackScopes : [],
      isLoopback,
    };
  }
}
