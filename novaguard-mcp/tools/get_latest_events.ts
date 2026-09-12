import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { DetectionEventDto, LatestEventsParams } from '../types';

export const getLatestEventsToolDefinition = {
  name: 'novaguard.get_latest_events',
  description: 'Convenience query returning the most recent surveillance events.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['Personne', 'Animal'] },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  },
};

export async function handleGetLatestEvents(
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  args: LatestEventsParams
): Promise<DetectionEventDto[]> {
  authorizer.authorize(context, ['novaguard:events:read', 'novaguard:read']);
  return client.getLatestEvents(args);
}
