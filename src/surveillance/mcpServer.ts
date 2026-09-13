import { NativeModules } from 'react-native';
import type { DetectionEvent, Settings, StorageInfo } from '../state/types';

export interface McpServerStatus {
  running: boolean;
  port: number;
  ipAddress: string | null;
  url: string | null;
  hasToken: boolean;
  /** True while no token is set: the socket is then bound to loopback only. */
  loopbackOnly: boolean;
  requestCount: number;
  lastActivityAt: number | null;
}

export const MCP_SERVER_STOPPED: McpServerStatus = {
  running: false,
  port: 8081,
  ipAddress: null,
  url: null,
  hasToken: false,
  loopbackOnly: true,
  requestCount: 0,
  lastActivityAt: null,
};

/**
 * What the native server answers from.
 *
 * Assembled here, field by field, rather than by handing over the settings
 * object: `localStreamPin` lives in there, and `mcp.md` §14 forbids exposing
 * it. Naming every field means a setting added later is absent from this
 * payload until someone puts it there on purpose — the opposite of a strip
 * list, which only removes the keys already thought of.
 */
export interface McpSnapshotInput {
  surveillanceActive: boolean;
  settings: Settings;
  storage: StorageInfo;
  events: DetectionEvent[];
  detectionsToday: number;
}

function nativeModule() {
  return NativeModules.McpServer;
}

export function buildMcpSnapshot(input: McpSnapshotInput): string {
  const { settings, storage, events, surveillanceActive, detectionsToday } = input;
  return JSON.stringify({
    surveillanceActive,
    camera: settings.camera,
    lastDetectionAt: events.length ? Math.max(...events.map(e => e.timestamp)) : null,
    detectionsToday,
    streamEnabled: settings.localStreamEnabled,
    storage: { used: storage.used, free: storage.free, total: storage.total },
    configuration: {
      camera: settings.camera,
      detection: {
        person: settings.person,
        animal: settings.animal,
        sensitivity: settings.sens,
        threshold: settings.threshold,
        preciseDetection: settings.preciseDetection,
        autoZoom: settings.autoZoom,
        zoneConfigured: Boolean(settings.zone),
      },
      recording: {
        quality: settings.quality,
        postRoll: settings.post,
        maxClipDuration: settings.max,
        retention: settings.retention,
        automaticDeletion: settings.autoDel,
      },
      notifications: {
        enabled: settings.notif,
        detectionNotifications: settings.notifDet,
      },
    },
    // Paths go across because the native side needs them to open the file; it
    // holds them internally and builds every response field by field, so they
    // never reach a caller. See McpEvent.toJson.
    events: events.map(e => ({
      id: e.id,
      kind: e.kind,
      timestamp: e.timestamp,
      dur: e.dur,
      conf: e.conf,
      path: e.path,
      bytes: e.bytes,
      thumbPath: e.thumbPath,
    })),
  });
}

export async function startMcpServer(port: number, token: string): Promise<McpServerStatus> {
  const module = nativeModule();
  if (!module) return { ...MCP_SERVER_STOPPED, port };
  return module.startServer(port, token);
}

export async function stopMcpServer(): Promise<boolean> {
  const module = nativeModule();
  if (!module) return true;
  return module.stopServer();
}

export async function getMcpServerStatus(): Promise<McpServerStatus> {
  const module = nativeModule();
  if (!module) return MCP_SERVER_STOPPED;
  return module.getServerStatus();
}

/**
 * A bearer token from the platform's CSPRNG.
 *
 * The fallback is for the test renderer, where no native module is registered;
 * on a device the native path is the only one taken. It is deliberately not
 * the other way round — `Math.random` is not a credential generator, and a
 * token is what decides whether this server is reachable from the Wi-Fi.
 */
export async function generateMcpToken(): Promise<string> {
  const module = nativeModule();
  if (module?.generateToken) return module.generateToken();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return `mcp_${token}`;
}

export function pushMcpSnapshot(input: McpSnapshotInput): void {
  const module = nativeModule();
  if (!module || !module.updateSnapshot) return;
  module.updateSnapshot(buildMcpSnapshot(input));
}
