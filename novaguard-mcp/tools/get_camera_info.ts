import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { CameraInfoDto } from '../types';

export const getCameraInfoToolDefinition = {
  name: 'novaguard.get_camera_info',
  description: 'Returns safe diagnostic information for the active camera.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

export async function handleGetCameraInfo(
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext,
  _args: Record<string, any>
): Promise<CameraInfoDto> {
  authorizer.authorize(context, ['novaguard:configuration:read', 'novaguard:read']);
  return client.getCameraInfo();
}
