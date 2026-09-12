import { readEventResource } from './event';
import { readVideoResource } from './video';
import { readThumbnailResource } from './thumbnail';
import { readTimelineResource } from './timeline';
import { readStatisticsResource } from './statistics';
import { readStatusResource } from './status';
import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { Sanitizer } from '../security/sanitizer';

export const ALL_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'novaguard://status',
    name: 'Status',
    description: 'High-level NovaGuard surveillance status',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'novaguard://event/{eventId}',
    name: 'Event Metadata',
    description: 'Canonical event metadata for given eventId',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'novaguard://video/{eventId}',
    name: 'Event Video Recording',
    description: 'MP4 recording file for given eventId',
    mimeType: 'video/mp4',
  },
  {
    uriTemplate: 'novaguard://thumbnail/{eventId}',
    name: 'Event Thumbnail',
    description: 'JPEG thumbnail still for given eventId',
    mimeType: 'image/jpeg',
  },
  {
    uriTemplate: 'novaguard://timeline/{date}',
    name: 'Timeline',
    description: 'Chronological event list for single calendar day (YYYY-MM-DD)',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'novaguard://statistics/{period}',
    name: 'Statistics Summary',
    description: 'Aggregate statistics summary (today, 7d, 30d)',
    mimeType: 'application/json',
  },
];

export async function readResource(
  uri: string,
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text?: string; blob?: Buffer; uri: string }> {
  const { resourceType, param } = Sanitizer.validateResourceUri(uri);

  switch (resourceType) {
    case 'status': {
      const res = await readStatusResource(client, authorizer, context);
      return { ...res, uri };
    }
    case 'event': {
      const res = await readEventResource(param!, client, authorizer, context);
      return { ...res, uri };
    }
    case 'video': {
      return readVideoResource(param!, client, authorizer, context);
    }
    case 'thumbnail': {
      return readThumbnailResource(param!, client, authorizer, context);
    }
    case 'timeline': {
      const res = await readTimelineResource(param!, client, authorizer, context);
      return { ...res, uri };
    }
    case 'statistics': {
      const res = await readStatisticsResource(param!, client, authorizer, context);
      return { ...res, uri };
    }
    default:
      throw new Error(`Unhandled resource type: ${resourceType}`);
  }
}
