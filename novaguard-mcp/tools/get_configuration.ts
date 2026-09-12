import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { Sanitizer } from '../security/sanitizer';
import { ConfigurationDto } from '../types';

export const getConfigurationToolDefinition = {
  name: 'novaguard.get_configuration',
  description: 'Returns safe diagnostic configuration parameters (camera, detection settings, recording quality, retention, and notification state).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

export async function handleGetConfiguration(
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  _args: Record<string, any>
): Promise<ConfigurationDto> {
  authorizer.authorize(context, ['novaguard:configuration:read', 'novaguard:read']);
  const rawConfig = await client.getConfiguration();
  return Sanitizer.sanitizeConfiguration(rawConfig) as ConfigurationDto;
}
