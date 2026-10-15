import type { Settings } from '../state/types';
import { controlLive } from './mcpControl';

/**
 * What the MCP server offers, as the "Services MCP" page presents it.
 *
 * Names only: the descriptions are in the catalogues (`mcpService.*`), in the
 * owner's language, where the server's own are written for a model, in English.
 * `__tests__/mcpServices.test.ts` reads `McpCatalog.kt` and `McpPrompts.java`
 * and fails when this list and the server's drift apart — a page that lists a
 * tool the server dropped, or misses one it added, describes some other server.
 */
export const READ_TOOLS = [
  'get_status', 'get_diagnostics', 'search_events', 'get_latest_events', 'get_event', 'get_event_frames',
  'wait_for_event', 'get_statistics', 'get_storage', 'get_configuration', 'get_camera_info',
] as const;

export const CONTROL_TOOLS = [
  'start_surveillance', 'stop_surveillance', 'set_sensitivity', 'set_thresholds', 'keep_event', 'acknowledge_alert',
  'annotate_event',
] as const;

export const PROMPTS = ['night_report', 'review_alerts', 'diagnose_camera'] as const;

export const RESOURCES = ['status', 'event', 'thumbnail', 'video', 'timeline', 'statistics'] as const;

export const RESOURCE_URIS: Record<(typeof RESOURCES)[number], string> = {
  status: 'novaguard://status',
  event: 'novaguard://event/{eventId}',
  thumbnail: 'novaguard://thumbnail/{eventId}',
  video: 'novaguard://video/{eventId}',
  timeline: 'novaguard://timeline/{date}',
  statistics: 'novaguard://statistics/{period}',
};

/** The name a client sees in `tools/list`. */
export const TOOL_PREFIX = 'novaguard_';

/**
 * Whether an agent can drive the camera now, and if not, the one thing that
 * stops it — in the order the owner would have to fix them.
 */
export type ControlAvailability = 'serverOff' | 'switchOff' | 'noToken' | 'expired' | 'available';

export function controlAvailability(settings: Settings, now: number): ControlAvailability {
  if (!settings.mcpEnabled) return 'serverOff';
  if (!settings.mcpControlEnabled) return 'switchOff';
  if (!settings.mcpControlToken) return 'noToken';
  if (!controlLive(settings.mcpControlExpiresAt, now)) return 'expired';
  return 'available';
}
