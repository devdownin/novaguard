import { NovaGuardReadApi } from '../api';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';

export async function readStatusResource(
  client: NovaGuardReadApi,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text: string }> {
  authorizer.authorize(context, ['novaguard:read']);
  const status = await client.getStatus();

  return {
    mimeType: 'application/json',
    text: JSON.stringify(status, null, 2),
  };
}
