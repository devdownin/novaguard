import { NovaGuardReadApi } from '../api';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { StorageDetailDto } from '../types';

export const getStorageToolDefinition = {
  name: 'novaguard_get_storage',
  description: 'Returns measured storage information including used, free, total bytes and count of events and videos.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

export async function handleGetStorage(
  client: NovaGuardReadApi,
  authorizer: Authorizer,
  context: SecurityContext,
  _args: Record<string, any>
): Promise<StorageDetailDto> {
  authorizer.authorize(context, ['novaguard:read']);
  return client.getStorage();
}
