import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { StatisticsParams, StatisticsResultDto } from '../types';

export const getStatisticsToolDefinition = {
  name: 'novaguard.get_statistics',
  description: 'Returns aggregate surveillance statistics for a time period without loading raw media.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      groupBy: { type: 'string', enum: ['hour', 'day', 'kind'] },
    },
  },
};

export async function handleGetStatistics(
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  args: StatisticsParams
): Promise<StatisticsResultDto> {
  authorizer.authorize(context, ['novaguard:statistics:read', 'novaguard:read']);
  return client.getStatistics(args);
}
