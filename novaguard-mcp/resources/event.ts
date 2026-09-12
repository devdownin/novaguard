import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';

export async function readEventResource(
  eventIdStr: string,
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text: string }> {
  authorizer.authorize(context, ['novaguard:events:read', 'novaguard:read']);
  const eventId = parseInt(eventIdStr, 10);
  const event = await client.getEvent(eventId);
  return {
    mimeType: 'application/json',
    text: JSON.stringify(event, null, 2),
  };
}
