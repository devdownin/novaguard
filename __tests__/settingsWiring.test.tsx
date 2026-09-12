/**
 * Settings have to survive a restart and take effect while the app runs.
 *
 * Both halves have gone wrong here before: earlier builds shipped a whole
 * NOTIFICATIONS section whose switches were read only to render their own
 * label, and simulated permissions that no OS call backed. Nothing guarded
 * either, so the failure was invisible until someone tried the feature.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mountProvider } from '../testing/mountProvider';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';
import { FrameDetection } from '../src/ml/types';
import { DEFAULT_TRACKER_OPTIONS } from '../src/ml/tracker';

jest.mock('../src/surveillance/foregroundService');

const SETTINGS_KEY = '@novaguard:settings';

const person = (x: number, confidence = 0.9): FrameDetection =>
  ({ kind: 'Personne', confidence, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

async function storedSettings(): Promise<Settings> {
  return JSON.parse((await AsyncStorage.getItem(SETTINGS_KEY))!);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('generates and clears MCP token', async () => {
  const handle = await mountProvider();
  expect(handle.state.settings.mcpToken).toBe('');

  await ReactTestRenderer.act(async () => { handle.state.generateMcpToken(); });
  expect(handle.state.settings.mcpToken).toMatch(/^mcp_[A-Za-z0-9]{24}$/);

  const written = await storedSettings();
  expect(written.mcpToken).toBe(handle.state.settings.mcpToken);

  await ReactTestRenderer.act(async () => { handle.state.clearMcpToken(); });
  expect(handle.state.settings.mcpToken).toBe('');
});

it('persists every settings field, not just the one that changed', async () => {
  const { state } = await mountProvider();

  await ReactTestRenderer.act(async () => { state.toggleNight(); });

  const written = await storedSettings();
  // A partial write would silently reset the untouched fields to defaults on
  // the next launch, since hydration merges whatever it finds over them.
  expect(Object.keys(written).sort()).toEqual(Object.keys(defaultSettings).sort());
  expect(written.night).toBe(!defaultSettings.night);
});

it('writes each control back to disk', async () => {
  const { state } = await mountProvider();

  await ReactTestRenderer.act(async () => {
    state.togglePerson();
    state.toggleAnimal();
    state.toggleAutoZoom();
    state.toggleAutoTune();
    state.toggleForceCpu();
    state.toggleAutoDel();
    state.toggleNotif();
    state.toggleNotifDet();
    state.toggleMcpServer();
    state.toggleResumeOnLaunch();
    state.togglePreciseDetection();
    state.saveZone({ x: 0.5, y: 0.3, width: 0.5, height: 0.7 });
    state.setSensitivity('Haute');
    state.setThreshold(42);
    state.setRetention('1 jour');
    state.cycleCamera();
    state.cyclePost();
    state.cycleMax();
    state.cycleQuality();
  });

  expect(await storedSettings()).toMatchObject({
    person: !defaultSettings.person,
    animal: !defaultSettings.animal,
    autoZoom: !defaultSettings.autoZoom,
    autoTune: !defaultSettings.autoTune,
    forceCpu: !defaultSettings.forceCpu,
    autoDel: !defaultSettings.autoDel,
    notif: !defaultSettings.notif,
    notifDet: !defaultSettings.notifDet,
    mcpEnabled: !defaultSettings.mcpEnabled,
    resumeOnLaunch: !defaultSettings.resumeOnLaunch,
    preciseDetection: !defaultSettings.preciseDetection,
    zone: { x: 0.5, y: 0.3, width: 0.5, height: 0.7 },
    sens: 'Haute',
    threshold: 42,
    retention: '1 jour',
  });
});

/**
 * `reportDetections` reads the post-roll through a ref so its identity stays
 * stable for the frame-processor worklet. A ref is exactly where a setting goes
 * stale, so this pins that it does not: the session must outlive the old delay.
 */
it('honours a post-roll changed mid-session', async () => {
  // Read through the handle, not a destructured snapshot: `handle.state` is
  // reassigned on every render, so `events` below has to come from it live.
  const handle = await mountProvider();
  const { state } = handle;

  await ReactTestRenderer.act(async () => { state.cyclePost(); }); // 10 s → 30 s

  await ReactTestRenderer.act(async () => {
    state.reportDetections([person(0.3)], 9 / 16);
    state.reportDetections([person(0.31)], 9 / 16);
  });

  // The tracker rides out DEFAULT_TRACKER_OPTIONS.dropAfterMs of not seeing the
  // subject before letting it go, so an empty frame alone does not end the
  // session — the post-roll only starts once the track is actually dropped.
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(DEFAULT_TRACKER_OPTIONS.dropAfterMs + 100);
    state.reportDetections([], 9 / 16);
  });
  expect(handle.state.events).toHaveLength(0);

  // Past the old 10 s delay. A stale ref would have closed the session here.
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(15_000); });
  expect(handle.state.events).toHaveLength(0);

  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(20_000); });
  expect(handle.state.events).toHaveLength(1);
});

/**
 * The confidence threshold is consumed in `reportDetections`, not in the frame
 * processor: it decides which detections may *open* a track, while weaker ones
 * are still handed over so an open track can survive them. That move is what
 * makes it testable at all — the worklet is out of reach under Jest — and this
 * is the third leg the file exists for, since exposed and persisted say nothing
 * about whether anything reads it.
 */
describe('the confidence threshold', () => {
  const seePerson = async (handle: Awaited<ReturnType<typeof mountProvider>>, confidence: number) => {
    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([person(0.3, confidence)], 9 / 16);
      handle.state.reportDetections([person(0.31, confidence)], 9 / 16);
    });
  };

  it('opens no session for a subject below it', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.setThreshold(80); });

    await seePerson(handle, 0.6);
    expect(handle.state.det).toBeNull();
  });

  it('opens one for a subject above it', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.setThreshold(50); });

    await seePerson(handle, 0.6);
    expect(handle.state.det).toBe('Personne');
  });

  it('keeps a session alive on looks that could not have opened it', async () => {
    // The point of the split: a subject who turns away, or steps into shadow,
    // drops well below the threshold without having gone anywhere. One gate
    // ended the recording there and filed the rest as a second event.
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.setThreshold(70); });

    await seePerson(handle, 0.85);
    expect(handle.state.det).toBe('Personne');

    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([person(0.32, 0.41)], 9 / 16);
      handle.state.reportDetections([person(0.33, 0.38)], 9 / 16);
    });
    expect(handle.state.events).toHaveLength(0);
    expect(handle.state.det).toBe('Personne');
  });
});

/**
 * The detection zone, end to end. Its third leg is the one that matters most:
 * a stored zone is invisible once monitoring starts, and a zone that lets
 * nothing through looks exactly like an empty room.
 */
describe('the detection zone', () => {
  // Feet at x = 0.4 for the street, x = 0.8 for the garden; the zone is the
  // right-hand half.
  const at = (x: number): FrameDetection =>
    ({ kind: 'Personne', confidence: 0.9, box: { x: x - 0.1, y: 0.55, width: 0.2, height: 0.4 } });
  const GARDEN = { x: 0.5, y: 0.3, width: 0.5, height: 0.7 };

  const seeTwice = async (handle: Awaited<ReturnType<typeof mountProvider>>, x: number) => {
    await ReactTestRenderer.act(async () => {
      handle.state.reportDetections([at(x)], 9 / 16);
      handle.state.reportDetections([at(x + 0.01)], 9 / 16);
    });
  };

  it('records a subject inside it', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.saveZone(GARDEN); });
    await seeTwice(handle, 0.8);
    expect(handle.state.det).toBe('Personne');
  });

  it('ignores a subject outside it', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.saveZone(GARDEN); });
    await seeTwice(handle, 0.2);
    expect(handle.state.det).toBeNull();
  });

  it('watches the whole frame again once it is cleared', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.saveZone(GARDEN); });
    await seeTwice(handle, 0.2);
    expect(handle.state.det).toBeNull();

    await ReactTestRenderer.act(async () => { handle.state.saveZone(null); });
    await seeTwice(handle, 0.2);
    expect(handle.state.det).toBe('Personne');
  });

  it('sees nothing at all while the zone is being drawn', async () => {
    // The camera runs for the editor — it is the picture being drawn on — and
    // tracking what it sees would open a session, and a recording, behind a
    // screen whose buttons say "Annuler".
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.beginZoneEdit(); });
    expect(handle.state.zoneEditing).toBe(true);

    await seeTwice(handle, 0.8);
    expect(handle.state.det).toBeNull();

    await ReactTestRenderer.act(async () => { handle.state.cancelZoneEdit(); });
    await seeTwice(handle, 0.8);
    expect(handle.state.det).toBe('Personne');
  });

  it('opens the camera tab to draw on, and abandons the drawing on leaving it', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.setTab('setup'); });
    await ReactTestRenderer.act(async () => { handle.state.beginZoneEdit(); });
    expect(handle.state.tab).toBe('cam');

    await ReactTestRenderer.act(async () => { handle.state.setTab('hist'); });
    expect(handle.state.zoneEditing).toBe(false);
  });
});

/**
 * "Sensibilité" sets three things, and only one of them — the analysis rate —
 * lives in the frame processor. The other two reach the tracker through
 * `reportDetections`, which is what this checks: the profile is read live,
 * from the ref, on the frame path.
 */
describe('sensitivity beyond the frame rate', () => {
  const strong = (x: number): FrameDetection =>
    ({ kind: 'Personne', confidence: 0.95, box: { x, y: 0.3, width: 0.2, height: 0.5 } });

  it('records on the very first look at the lowest rate', async () => {
    // At 1 fps, waiting for a second look is waiting a second — the start of
    // every passage, every time.
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.setSensitivity('Basse'); });
    await ReactTestRenderer.act(async () => { handle.state.reportDetections([strong(0.3)], 9 / 16); });
    expect(handle.state.det).toBe('Personne');
  });

  it('still wants a second look at the default rate', async () => {
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.reportDetections([strong(0.3)], 9 / 16); });
    expect(handle.state.det).toBeNull();

    await ReactTestRenderer.act(async () => { handle.state.reportDetections([strong(0.31)], 9 / 16); });
    expect(handle.state.det).toBe('Personne');
  });

  it('asks a weaker look to clear a higher bar at the lowest rate', async () => {
    // The trade: one look instead of two, paid for with a score. A detection
    // over the slider's 60 % but under the profile's bar opens nothing.
    const handle = await mountProvider();
    await ReactTestRenderer.act(async () => { handle.state.setSensitivity('Basse'); });
    const middling: FrameDetection =
      { kind: 'Personne', confidence: 0.65, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.5 } };
    await ReactTestRenderer.act(async () => { handle.state.reportDetections([middling], 9 / 16); });
    expect(handle.state.det).toBeNull();
  });
});
