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

/**
 * Resources that exist right now, for `resources/list`.
 *
 * The list used to return the templates below, whose entries carry
 * `uriTemplate` and no `uri`. A conforming client reads `resources/list` for
 * things it can fetch, finds nothing fetchable, and shows an empty resource
 * list — the templates belong to `resources/templates/list`, which was not
 * implemented at all.
 *
 * Only the fixed entries are here. The per-event resources are templated, and
 * enumerating them would mean an authorised upstream query inside a listing
 * that clients call eagerly at connection time; `novaguard_search_events` is
 * how a client finds which event ids exist, and the template says how to name
 * one once it has.
 */
export const ALL_RESOURCES = [
  {
    uri: 'novaguard://status',
    name: 'Status',
    description: 'High-level NovaGuard surveillance status',
    mimeType: 'application/json',
  },
  {
    uri: 'novaguard://statistics/today',
    name: 'Statistics — today',
    description: 'Aggregate statistics for today',
    mimeType: 'application/json',
  },
  {
    uri: 'novaguard://statistics/7d',
    name: 'Statistics — last 7 days',
    description: 'Aggregate statistics for the last 7 days',
    mimeType: 'application/json',
  },
  {
    uri: 'novaguard://statistics/30d',
    name: 'Statistics — last 30 days',
    description: 'Aggregate statistics for the last 30 days',
    mimeType: 'application/json',
  },
];

export const ALL_RESOURCE_TEMPLATES = [
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
  context: SecurityContext,
  maxMediaBytes?: number
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
      return readVideoResource(param!, client, authorizer, context, maxMediaBytes);
    }
    case 'thumbnail': {
      return readThumbnailResource(param!, client, authorizer, context, maxMediaBytes);
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
