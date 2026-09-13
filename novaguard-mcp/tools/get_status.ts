import { NovaGuardReadApi } from '../api';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { StatusDto } from '../types';

export const getStatusToolDefinition = {
  name: 'novaguard_get_status',
  description: 'Returns high-level surveillance status (active state, camera, last detection time, today detection count, and storage summary).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

export async function handleGetStatus(
  client: NovaGuardReadApi,
  authorizer: Authorizer,
  context: SecurityContext,
  _args: Record<string, any>
): Promise<StatusDto> {
  authorizer.authorize(context, ['novaguard:read']);
  return client.getStatus();
}
