import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { DetectionEventDto, McpError } from '../types';

export const getEventToolDefinition = {
  name: 'novaguard.get_event',
  description: 'Returns single surveillance event details by ID.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['eventId'],
    properties: {
      eventId: { type: 'integer', minimum: 0 },
    },
  },
};

export async function handleGetEvent(
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  args: { eventId: number }
): Promise<DetectionEventDto> {
  authorizer.authorize(context, ['novaguard:events:read', 'novaguard:read']);
  if (args.eventId === undefined || args.eventId === null) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Missing required parameter eventId', 400);
  }
  return client.getEvent(args.eventId);
}
