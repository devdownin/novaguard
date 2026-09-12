import { McpError } from '../types';
import { SecurityContext } from './authentication';

const SCOPE_ALIASES: Record<string, string[]> = {
  'novaguard:status:read': ['novaguard:status'],
  'novaguard:events:read': ['novaguard:events'],
  'novaguard:statistics:read': ['novaguard:statistics'],
  'novaguard:configuration:read': ['novaguard:configuration'],
  'novaguard:media:read': ['novaguard:media'],
};

export class Authorizer {
  public authorize(context: SecurityContext, requiredScopes: string | string[]) {
    const scopesNeeded = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

    // Legacy umbrella scope remains valid only when explicitly granted.
    if (context.scopes.includes('novaguard:read')) {
      return;
    }

    const hasAccess = scopesNeeded.some((scope) => {
      if (context.scopes.includes(scope)) return true;
      return (SCOPE_ALIASES[scope] || []).some((alias) => context.scopes.includes(alias));
    });

    if (!hasAccess) {
      throw new McpError(
        'NOVAGUARD_AUTH_FORBIDDEN',
        `Insufficient privileges. Required scopes: ${scopesNeeded.join(', ')}`,
        403
      );
    }
  }
}
