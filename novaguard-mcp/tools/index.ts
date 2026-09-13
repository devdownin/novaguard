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
import { validateArguments, ToolInputSchema } from './validateArguments';
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

/**
 * Reduces any spelling of a tool name to its bare operation.
 *
 * `tools/list` advertises `novaguard_get_status`, because a dot is outside the
 * `^[a-zA-Z0-9_-]{1,64}$` pattern clients apply to tool names — a dotted
 * catalogue is one they refuse to load. `mcp.md` writes them with a dot, and
 * anything built against the document keeps working: both prefixes come back
 * to the same operation here, in one place, rather than as two switch arms
 * that can drift.
 */
export function toolOperation(name: string): string | null {
  for (const prefix of ['novaguard_', 'novaguard.']) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  // An unprefixed name is not a tool this server has ever advertised. Taking
  // it anyway would mean answering to spellings nobody was told about.
  return null;
}

const SCHEMAS: Record<string, ToolInputSchema> = Object.fromEntries(
  ALL_TOOLS.map(tool => [toolOperation(tool.name)!, tool.inputSchema as ToolInputSchema]),
);

/** Whether the catalogue advertises this name, under either prefix. */
export function isKnownTool(name: string): boolean {
  const operation = toolOperation(name);
  return operation !== null && operation in SCHEMAS;
}

/**
 * Refuses a mutating operation by name.
 *
 * Called before dispatch rather than inside it, because the refusal is not an
 * outcome of running a tool — nothing ran, and nothing a caller could send
 * would change that. That is what keeps it a JSON-RPC error while a genuine
 * execution failure comes back as a result carrying `isError`.
 */
export function assertNotForbidden(name: string): void {
  // Falls back to the raw name so a bare `delete_event` is refused as plainly
  // as a prefixed one, rather than reported as an unknown tool.
  if (FORBIDDEN_OPERATIONS.has(toolOperation(name) ?? name)) {
    throw new McpError(
      'NOVAGUARD_INVALID_ARGUMENT',
      `Operation '${name}' is strictly forbidden on NovaGuard read-only MCP server`,
      400
    );
  }
}

export async function executeToolCall(
  name: string,
  args: Record<string, any> = {},
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<any> {
  const operation = toolOperation(name);
  assertNotForbidden(name);

  const schema = operation ? SCHEMAS[operation] : undefined;
  if (!operation || !schema) throw new McpError('NOVAGUARD_NOT_FOUND', `Unknown tool: '${name}'`, 404);
  validateArguments(name, schema, args);

  switch (operation) {
    case 'get_status':
      return handleGetStatus(client, authorizer, context, args);
    case 'search_events':
      return handleSearchEvents(client, authorizer, context, args);
    case 'get_event':
      return handleGetEvent(client, authorizer, context, args as any);
    case 'get_latest_events':
      return handleGetLatestEvents(client, authorizer, context, args);
    case 'get_statistics':
      return handleGetStatistics(client, authorizer, context, args as any);
    case 'get_storage':
      return handleGetStorage(client, authorizer, context, args);
    case 'get_configuration':
      return handleGetConfiguration(client, authorizer, context, args);
    case 'get_camera_info':
      return handleGetCameraInfo(client, authorizer, context, args);
    default:
      throw new McpError('NOVAGUARD_NOT_FOUND', `Unknown tool: '${name}'`, 404);
  }
}
