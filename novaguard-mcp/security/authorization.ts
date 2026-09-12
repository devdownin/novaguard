import { McpError } from '../types';
import { SecurityContext } from './authentication';

export class Authorizer {
  public authorize(context: SecurityContext, requiredScopes: string | string[]) {
    const scopesNeeded = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

    // novaguard:read grants access to everything
    if (context.scopes.includes('novaguard:read')) {
      return;
    }

    const hasAccess = scopesNeeded.some((scope) => context.scopes.includes(scope));
    if (!hasAccess) {
      throw new McpError(
        'NOVAGUARD_AUTH_FORBIDDEN',
        `Insufficient privileges. Required scopes: ${scopesNeeded.join(', ')}`,
        403
      );
    }
  }
}
