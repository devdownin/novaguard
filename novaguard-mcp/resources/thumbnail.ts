import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { McpError } from '../types';

export async function readThumbnailResource(
  eventIdStr: string,
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  maxBytes?: number
): Promise<{ mimeType: string; blob: Buffer; uri: string }> {
  authorizer.authorize(context, ['novaguard:media', 'novaguard:read']);
  const eventId = parseInt(eventIdStr, 10);
  const media = await client.getThumbnail(eventId, maxBytes);

  if (!media) {
    throw new McpError('NOVAGUARD_MEDIA_UNAVAILABLE', `Thumbnail resource for event ${eventIdStr} unavailable`, 404);
  }

  return {
    mimeType: media.mimeType,
    blob: media.data,
    uri: `novaguard://thumbnail/${eventIdStr}`,
  };
}
