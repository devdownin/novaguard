import { getStatusToolDefinition, handleGetStatus } from './get_status';
import { searchEventsToolDefinition, handleSearchEvents } from './search_events';
import { getEventToolDefinition, handleGetEvent } from './get_event';
import { getLatestEventsToolDefinition, handleGetLatestEvents } from './get_latest_events';
import { getStatisticsToolDefinition, handleGetStatistics } from './get_statistics';
import { getStorageToolDefinition, handleGetStorage } from './get_storage';
import { getConfigurationToolDefinition, handleGetConfiguration } from './get_configuration';
import { getCameraInfoToolDefinition, handleGetCameraInfo } from './get_camera_info';
import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { McpError } from '../types';

export const ALL_TOOLS = [
  getStatusToolDefinition,
  searchEventsToolDefinition,
  getEventToolDefinition,
  getLatestEventsToolDefinition,
  getStatisticsToolDefinition,
  getStorageToolDefinition,
  getConfigurationToolDefinition,
  getCameraInfoToolDefinition,
];

export const FORBIDDEN_OPERATIONS = new Set([
  'start_surveillance',
  'stop_surveillance',
  'arm_camera',
  'disarm_camera',
  'set_camera',
  'set_detection_threshold',
  'set_detection_zone',
  'set_sensitivity',
  'set_recording_quality',
  'set_retention',
  'set_notification_settings',
  'delete_event',
  'delete_video',
  'clear_history',
  'change_stream_pin',
  'restart_camera',
  'update_configuration',
]);

export async function executeToolCall(
  name: string,
  args: Record<string, any> = {},
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<any> {
  if (FORBIDDEN_OPERATIONS.has(name) || FORBIDDEN_OPERATIONS.has(name.replace('novaguard.', ''))) {
    throw new McpError(
      'NOVAGUARD_INVALID_ARGUMENT',
      `Operation '${name}' is strictly forbidden on NovaGuard read-only MCP server`,
      400
    );
  }

  switch (name) {
    case 'novaguard.get_status':
      return handleGetStatus(client, authorizer, context, args);
    case 'novaguard.search_events':
      return handleSearchEvents(client, authorizer, context, args);
    case 'novaguard.get_event':
      return handleGetEvent(client, authorizer, context, args as any);
    case 'novaguard.get_latest_events':
      return handleGetLatestEvents(client, authorizer, context, args);
    case 'novaguard.get_statistics':
      return handleGetStatistics(client, authorizer, context, args as any);
    case 'novaguard.get_storage':
      return handleGetStorage(client, authorizer, context, args);
    case 'novaguard.get_configuration':
      return handleGetConfiguration(client, authorizer, context, args);
    case 'novaguard.get_camera_info':
      return handleGetCameraInfo(client, authorizer, context, args);
    default:
      throw new McpError('NOVAGUARD_NOT_FOUND', `Unknown tool: '${name}'`, 404);
  }
}
