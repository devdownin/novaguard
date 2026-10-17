import { NativeEventEmitter, NativeModules } from 'react-native';
import type { DetectionEvent, Settings, StorageInfo } from '../state/types';
import type { SurveillanceStatus } from './status';
import { keptEventIds } from '../recording/library';
import { ClipGapStats, meanGapMs } from '../recording/clipGap';
import type { AutoTuneState } from '../camera/autoTune';
import type { CameraHealth } from '../camera/cameraHealth';
import type { FrameStage } from '../camera/frameTrace';

export interface McpServerStatus {
  running: boolean;
  port: number;
  ipAddress: string | null;
  url: string | null;
  hasToken: boolean;
  /** Whether control tools are on offer right now: switch on, token set, not expired. */
  controlEnabled?: boolean;
  /** Whether the server is advertised over DNS-SD (`_novaguard-mcp._tcp`). */
  advertised?: boolean;
  /** HTTPS under the device authority. */
  tls?: boolean;
  /** True while no token is set: the socket is then bound to loopback only. */
  loopbackOnly: boolean;
  requestCount: number;
  lastActivityAt: number | null;
  /** The connection to the cloud relay; `off` when the owner has not asked for it. */
  relayState?: RelayState;
  /** Where cloud clients reach this phone, once the relay has accepted it. */
  relayUrl?: string | null;
}

export type RelayState = 'off' | 'connecting' | 'connected' | 'offline' | 'refused';

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
  /**
   * What the viewfinder and the notification say. `surveillanceActive` alone
   * told an agent the camera was running while its lens was covered, and
   * "nothing tonight" is the one wrong answer that reads as a right one.
   */
  status: SurveillanceStatus;
  diagnostics: McpDiagnostics;
}

/**
 * Why the camera may miss or cut passages, for `get_diagnostics`.
 *
 * Everything here already exists on the device and is shown in Réglages: the
 * clip gap, what self-tuning gave up, the camera session's health, the step a
 * previous launch crashed in. None of it changes per frame — the frame rate is
 * the one taken when the self-tuning loop last decided, not the live figure —
 * so pushing it costs nothing on the analysis path.
 */
export interface McpDiagnostics {
  clipGap: {
    samples: number; meanMs: number; worstMs: number;
    lastFinalizeMs: number | null; lastRestartMs: number | null;
  };
  autoTune: {
    enabled: boolean; given: string[]; blocked: string[];
    measuredFps: number | null; targetFps: number | null;
  };
  cameraSession: CameraHealth;
  crashedStage: FrameStage | null;
}

export function buildMcpDiagnostics(input: {
  clipGap: ClipGapStats; autoTune: AutoTuneState; autoTuneEnabled: boolean;
  cameraHealth: CameraHealth; crashedStage: FrameStage | null;
}): McpDiagnostics {
  const { clipGap, autoTune, autoTuneEnabled, cameraHealth, crashedStage } = input;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    clipGap: {
      samples: clipGap.samples,
      meanMs: Math.round(meanGapMs(clipGap)),
      worstMs: Math.round(clipGap.worstMs),
      lastFinalizeMs: clipGap.last ? Math.round(clipGap.last.finalizeMs) : null,
      lastRestartMs: clipGap.last ? Math.round(clipGap.last.restartMs) : null,
    },
    autoTune: {
      enabled: autoTuneEnabled,
      given: [...autoTune.applied],
      blocked: [...autoTune.blocked],
      measuredFps: autoTune.decided ? round(autoTune.decided.measured) : null,
      targetFps: autoTune.decided ? round(autoTune.decided.target) : null,
    },
    cameraSession: cameraHealth,
    crashedStage,
  };
}

/**
 * Detector confidence on the `[0,1]` scale `mcp.md` §11 promises.
 *
 * Events store it as a whole percent (`Math.round(max * 100)`), so a client
 * filtering on `minConfidence: 0.6` was comparing against 87 and kept
 * everything. Values already at or under 1 are from histories written before
 * the percent form and are passed through.
 */
export function unitConfidence(stored: number): number {
  return stored > 1 ? Math.round(stored) / 100 : stored;
}

function nativeModule() {
  return NativeModules.McpServer;
}

export function buildMcpSnapshot(input: McpSnapshotInput): string {
  const { settings, storage, events, surveillanceActive, detectionsToday, status, diagnostics } = input;
  const kept = keptEventIds(events);
  return JSON.stringify({
    surveillanceActive,
    status,
    camera: settings.camera,
    lastDetectionAt: events.length ? Math.max(...events.map(e => e.timestamp)) : null,
    detectionsToday,
    streamEnabled: settings.localStreamEnabled,
    // What the server advertises `get_live_frame` on; the frame processor reads the same setting.
    liveFrameAllowed: settings.mcpLiveFrameEnabled,
    diagnostics,
    storage: { used: storage.used, free: storage.free, total: storage.total },
    configuration: {
      camera: settings.camera,
      detection: {
        person: settings.person,
        animal: settings.animal,
        sensitivity: settings.sens,
        // Entry gates, on the same [0,1] scale as event confidence.
        threshold: settings.threshold / 100,
        animalThreshold: settings.animalThreshold / 100,
        preciseDetection: settings.preciseDetection,
        autoZoom: settings.autoZoom,
        zoneConfigured: Boolean(settings.zone),
        ignoredZones: settings.exclusions.length,
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
        alertPicture: settings.notifPicture,
        // Local hours on the phone, start included and end excluded.
        quietHours: settings.quietHours ? { start: settings.quietStart, end: settings.quietEnd } : null,
      },
    },
    // Paths go across because the native side needs them to open the file; it
    // holds them internally and builds every response field by field, so they
    // never reach a caller. See McpEvent.toJson.
    events: events.map(e => ({
      id: e.id,
      kind: e.kind,
      timestamp: e.timestamp,
      passageId: e.passageId ?? null,
      kinds: e.kinds ?? [e.kind],
      kept: kept.has(e.id),
      dur: e.dur,
      conf: unitConfidence(e.conf),
      path: e.path,
      bytes: e.bytes,
      thumbPath: e.thumbPath,
      // Where to crop for `get_event_frames` framing "subject"; never returned as is.
      subject: e.subject ?? [],
      agentNote: e.agentNote ?? null,
    })),
  });
}

/**
 * `controlToken` is honoured only while `controlEnabled`: the device switch is
 * what grants control, the token only says who holds it.
 */
export async function startMcpServer(
  port: number, token: string, controlToken = '', controlEnabled = false, controlExpiresAt = 0, tls = false,
): Promise<McpServerStatus> {
  const module = nativeModule();
  if (!module) return { ...MCP_SERVER_STOPPED, port };
  return module.startServer(port, token, controlToken, controlEnabled, controlExpiresAt, tls);
}

/** The device authority a client must trust for HTTPS: PEM to install, fingerprint to compare. */
export async function getMcpCaCertificate(): Promise<{ pem: string; fingerprint: string } | null> {
  const module = nativeModule();
  if (!module?.getCaCertificate) return null;
  try {
    return await module.getCaCertificate();
  } catch {
    return null;
  }
}

/** "Couper le pilotage" was tapped on the notification; the server has already dropped control. */
export function onMcpControlRevoked(handler: () => void): () => void {
  const module = nativeModule();
  if (!module) return () => {};
  const subscription = new NativeEventEmitter(module).addListener('McpControlRevoked', handler);
  return () => subscription.remove();
}

/** A control call the native server is waiting on (see `McpServerModule.runCommand`). */
export interface McpCommandRequest {
  id: string;
  command: string;
  /** JSON object, already validated against the advertised schema. */
  args: string;
}

/**
 * Subscribes to control calls. The native side holds the HTTP request open
 * until `resolveMcpCommand` answers it, or gives up after a few seconds.
 */
export function onMcpCommand(handler: (request: McpCommandRequest) => void): () => void {
  const module = nativeModule();
  if (!module) return () => {};
  const subscription = new NativeEventEmitter(module).addListener('McpCommand', handler);
  return () => subscription.remove();
}

export function resolveMcpCommand(id: string, outcomeJson: string): void {
  nativeModule()?.resolveCommand?.(id, outcomeJson);
}

/**
 * Dials the relay so cloud clients can reach the server. The native side needs
 * the server running with a read token, and answers reads only.
 */
export async function startMcpRelay(address: string, liveAllowed: boolean): Promise<McpServerStatus> {
  const module = nativeModule();
  if (!module?.startRelay) return MCP_SERVER_STOPPED;
  return module.startRelay(address, liveAllowed);
}

export async function stopMcpRelay(): Promise<McpServerStatus> {
  const module = nativeModule();
  if (!module?.stopRelay) return MCP_SERVER_STOPPED;
  return module.stopRelay();
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
