import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { SearchEventsParams, SearchEventsResultDto } from '../types';

export const searchEventsToolDefinition = {
  name: 'novaguard.search_events',
  description: 'Primary surveillance-history query with pagination and time filters.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      kind: { type: 'string', enum: ['Personne', 'Animal'] },
      minConfidence: { type: 'number', minimum: 0, maximum: 1 },
      hasVideo: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0, maximum: 10000 },
      sort: { type: 'string', enum: ['timestamp_desc', 'timestamp_asc'] },
    },
  },
};

export async function handleSearchEvents(
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  args: SearchEventsParams
): Promise<SearchEventsResultDto> {
  authorizer.authorize(context, ['novaguard:events:read', 'novaguard:read']);
  return client.searchEvents(args);
}
