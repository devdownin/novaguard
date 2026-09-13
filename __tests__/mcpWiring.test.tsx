/**
 * The MCP switch has to start a server, and the server has to be handed data.
 *
 * This whole section shipped inert: `mcpEnabled`, `mcpPort` and `mcpToken`
 * were exposed and persisted, the screen printed a URL and offered a client
 * configuration, and no code read any of the three — the implementation was
 * Node, which cannot run in Hermes, so there was never a socket at either end
 * of the address the app was advertising. The same failure as the NOTIFICATIONS
 * section before it, and invisible for the same reason: everything the user
 * can see works.
 *
 * So the three halves are locked here: exposed, persisted, and consumed.
 *
 * @format
 */

import { NativeModules } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { mountProvider } from '../testing/mountProvider';
import { buildMcpSnapshot } from '../src/surveillance/mcpServer';
import { defaultSettings } from '../src/state/defaults';
import { DetectionEvent } from '../src/state/types';
import { FrameDetection } from '../src/ml/types';
import { DEFAULT_TRACKER_OPTIONS } from '../src/ml/tracker';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../src/surveillance/foregroundService');

const person = (x: number, confidence = 0.9): FrameDetection =>
  ({ kind: 'Personne', confidence, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

const native = {
  startServer: jest.fn(async (port: number) => ({
    running: true, port, ipAddress: null, url: `http://127.0.0.1:${port}/mcp`,
    hasToken: true, loopbackOnly: false, requestCount: 0, lastActivityAt: null,
  })),
  stopServer: jest.fn(async () => true),
  getServerStatus: jest.fn(async () => ({
    running: true, port: 8081, ipAddress: null, url: 'http://127.0.0.1:8081/mcp',
    hasToken: true, loopbackOnly: false, requestCount: 3, lastActivityAt: 1_700_000_000_000,
  })),
  updateSnapshot: jest.fn(),
  generateToken: jest.fn(async () => 'mcp_' + 'a'.repeat(32)),
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (NativeModules as Record<string, unknown>).McpServer = native;
});

afterEach(() => {
  jest.useRealTimers();
});

it('starts the native server when the setting is switched on, and stops it again', async () => {
  const handle = await mountProvider();
  expect(native.startServer).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => {});

  expect(native.startServer).toHaveBeenCalledWith(defaultSettings.mcpPort, '');
  expect(handle.state.mcpStatus.running).toBe(true);

  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => {});

  expect(native.stopServer).toHaveBeenCalled();
  expect(handle.state.mcpStatus.running).toBe(false);
});

it('restarts the server with the new token when one is generated', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => {});

  await ReactTestRenderer.act(async () => { handle.state.generateMcpToken(); });
  await ReactTestRenderer.act(async () => {});

  // A token is what lets the server leave loopback, so a token the running
  // server does not have is a token that does nothing.
  expect(native.startServer).toHaveBeenLastCalledWith(defaultSettings.mcpPort, 'mcp_' + 'a'.repeat(32));
});

it('pushes a snapshot when the history changes', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => {});

  const before = native.updateSnapshot.mock.calls.length;
  expect(before).toBeGreaterThan(0);

  // A confirmed subject opens a session and writes an event. A server whose
  // snapshot stops at the state it was started with answers every question
  // about the last hour with the history of an hour ago.
  await ReactTestRenderer.act(async () => {
    handle.state.reportDetections([person(0.3)], 9 / 16);
    handle.state.reportDetections([person(0.31)], 9 / 16);
  });
  // The tracker rides out `dropAfterMs` before letting a subject go, and the
  // post-roll only starts once it has.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(DEFAULT_TRACKER_OPTIONS.dropAfterMs + 100);
    handle.state.reportDetections([], 9 / 16);
  });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(30_000); });
  await ReactTestRenderer.act(async () => {});

  expect(handle.state.events.length).toBeGreaterThan(0);
  const pushed = JSON.parse(native.updateSnapshot.mock.calls.at(-1)![0]);
  expect(pushed.events.length).toBe(handle.state.events.length);
});

it('pushes nothing while the server is off', async () => {
  await mountProvider();
  await ReactTestRenderer.act(async () => {});
  expect(native.updateSnapshot).not.toHaveBeenCalled();
});

it('reports the running server activity rather than a local guess', async () => {
  const handle = await mountProvider();
  await ReactTestRenderer.act(async () => { handle.state.toggleMcpServer(); });
  await ReactTestRenderer.act(async () => {});

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(2_500); });
  await ReactTestRenderer.act(async () => {});

  expect(native.getServerStatus).toHaveBeenCalled();
  expect(handle.state.mcpStatus.lastActivityAt).toBe(1_700_000_000_000);
  expect(handle.state.mcpStatus.requestCount).toBe(3);
});

describe('the snapshot handed to the native server', () => {
  const event = (over: Partial<DetectionEvent> = {}): DetectionEvent => ({
    id: 7, kind: 'Personne', timestamp: 1_700_000_000_000, dur: 12, conf: 0.91,
    path: '/data/user/0/com.novaguard.surveillance/files/clips/Personne_7.mp4',
    bytes: 4_096, thumbPath: '/data/user/0/com.novaguard.surveillance/files/thumbs/7.jpg',
    ...over,
  });

  const build = (over: Partial<typeof defaultSettings> = {}) => JSON.parse(buildMcpSnapshot({
    surveillanceActive: true,
    settings: { ...defaultSettings, localStreamPin: 'SECRET_PIN_9999', ...over },
    storage: { used: 4_096, free: 1_000, total: 2_000 },
    events: [event()],
    detectionsToday: 1,
  }));

  it('never carries the stream PIN', () => {
    // `mcp.md` §14 forbids exposing it, and the snapshot is assembled field by
    // field rather than spread from `settings` precisely so that a setting
    // added later cannot ride along into it.
    const raw = JSON.stringify(build());
    expect(raw).not.toContain('SECRET_PIN_9999');
    expect(raw).not.toContain('localStreamPin');
  });

  it('carries the media paths, which the native side needs and never returns', () => {
    // Asserted rather than assumed: the paths are how a clip is opened on
    // disk. What must not happen is a path reaching a caller, which is the
    // native side's contract (McpEvent.toJson builds its own object) — if this
    // ever becomes the place paths are stripped, the media resources stop
    // resolving and the failure is silent.
    expect(build().events[0].path).toContain('Personne_7.mp4');
    expect(build().events[0].thumbPath).toContain('7.jpg');
  });

  it('reports the newest event as the last detection', () => {
    expect(build().lastDetectionAt).toBe(1_700_000_000_000);
  });

  it('exposes the configuration the document describes', () => {
    const config = build({ quality: '4K', retention: '7 jours' }).configuration;
    expect(config.recording.quality).toBe('4K');
    expect(config.recording.retention).toBe('7 jours');
    expect(config.detection.sensitivity).toBe(defaultSettings.sens);
    expect(config.detection.zoneConfigured).toBe(false);
  });
});
