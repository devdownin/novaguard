/**
 * What an agent holding the control token can do, and what it cannot.
 *
 * @format
 */
import { CommandDeps, executeMcpCommand } from '../src/surveillance/mcpCommands';
import { appendAgentAction, AGENT_LOG_LIMIT, parseAgentLog } from '../src/surveillance/agentLog';
import { defaultSettings } from '../src/state/defaults';
import { DetectionEvent } from '../src/state/types';

const event = (id: number, over: Partial<DetectionEvent> = {}): DetectionEvent => ({
  id, kind: 'Personne', timestamp: id, dur: 5, conf: 80, path: null, bytes: 0, thumbPath: null, ...over,
});

function deps(over: Partial<CommandDeps> = {}): CommandDeps & { [k: string]: any } {
  return {
    monitoring: false, foreground: true, cameraPermission: true, status: 'inactive',
    settings: { ...defaultSettings, threshold: 60, animalThreshold: 60, sens: 'Moyenne' },
    events: [event(1, { passageId: 'p' }), event(2, { passageId: 'p' }), event(3)],
    toggleMonitoring: jest.fn(), setSensitivity: jest.fn(), setThreshold: jest.fn(),
    setAnimalThreshold: jest.fn(), setKept: jest.fn(), setAgentNote: jest.fn(), acknowledgeMove: jest.fn(),
    ...over,
  };
}

describe('start and stop', () => {
  it('starts only when stopped, on screen, with the camera permission', () => {
    const d = deps();
    expect(executeMcpCommand('start_surveillance', {}, d)).toEqual({ ok: true, changed: true, result: { surveillanceActive: true } });
    expect(d.toggleMonitoring).toHaveBeenCalledTimes(1);
  });

  it('says why it cannot start from the background, rather than starting a camera Android will refuse', () => {
    const d = deps({ foreground: false });
    const outcome = executeMcpCommand('start_surveillance', {}, d);
    expect(outcome).toMatchObject({ ok: false, code: 'NOVAGUARD_DEVICE_UNAVAILABLE' });
    expect(d.toggleMonitoring).not.toHaveBeenCalled();
  });

  it('refuses without the camera permission', () => {
    expect(executeMcpCommand('start_surveillance', {}, deps({ cameraPermission: false })))
      .toMatchObject({ ok: false, code: 'NOVAGUARD_PERMISSION_REQUIRED' });
  });

  it('is idempotent both ways, and never toggles the wrong way', () => {
    const running = deps({ monitoring: true });
    expect(executeMcpCommand('start_surveillance', {}, running)).toMatchObject({ ok: true, changed: false });
    expect(running.toggleMonitoring).not.toHaveBeenCalled();
    const stopped = deps();
    expect(executeMcpCommand('stop_surveillance', {}, stopped)).toMatchObject({ ok: true, changed: false });
    expect(stopped.toggleMonitoring).not.toHaveBeenCalled();
    const stopping = deps({ monitoring: true, foreground: false });
    expect(executeMcpCommand('stop_surveillance', {}, stopping)).toMatchObject({ ok: true, changed: true });
    expect(stopping.toggleMonitoring).toHaveBeenCalledTimes(1);
  });
});

describe('settings', () => {
  it('sets a valid sensitivity only', () => {
    const d = deps();
    expect(executeMcpCommand('set_sensitivity', { sensitivity: 'Haute' }, d)).toMatchObject({ ok: true, changed: true });
    expect(d.setSensitivity).toHaveBeenCalledWith('Haute');
    expect(executeMcpCommand('set_sensitivity', { sensitivity: 'Moyenne' }, d)).toMatchObject({ changed: false });
    expect(executeMcpCommand('set_sensitivity', { sensitivity: 'Max' }, d)).toMatchObject({ ok: false });
  });

  it('takes thresholds on [0,1], stores them as percents within the sliders’ range', () => {
    const d = deps();
    expect(executeMcpCommand('set_thresholds', { person: 0.72 }, d)).toEqual({
      ok: true, changed: true, result: { person: 0.72, animal: 0.6 },
    });
    expect(d.setThreshold).toHaveBeenCalledWith(72);
    expect(d.setAnimalThreshold).not.toHaveBeenCalled();
    executeMcpCommand('set_thresholds', { animal: 0.1 }, d);
    expect(d.setAnimalThreshold).toHaveBeenCalledWith(50);
    expect(executeMcpCommand('set_thresholds', {}, d)).toMatchObject({ ok: false, code: 'NOVAGUARD_INVALID_ARGUMENT' });
    expect(executeMcpCommand('set_thresholds', { person: 'high' }, d)).toMatchObject({ ok: false });
  });
});

describe('evidence and alerts', () => {
  it('keeps a passage through any of its events, and refuses an unknown one', () => {
    const d = deps();
    expect(executeMcpCommand('keep_event', { eventId: 2, kept: true }, d)).toMatchObject({ ok: true, changed: true });
    expect(d.setKept).toHaveBeenCalledWith(2, true);
    expect(executeMcpCommand('keep_event', { eventId: 99, kept: true }, d)).toMatchObject({ ok: false, code: 'NOVAGUARD_NOT_FOUND' });
    const kept = deps({ events: [event(1, { passageId: 'p', kept: true }), event(2, { passageId: 'p' })] });
    expect(executeMcpCommand('keep_event', { eventId: 2, kept: true }, kept)).toMatchObject({ ok: true, changed: false });
  });

  it('acknowledges a moved camera only; a black picture is not the agent’s to clear', () => {
    const moved = deps({ status: 'camera-moved' });
    expect(executeMcpCommand('acknowledge_alert', {}, moved)).toMatchObject({ ok: true, changed: true });
    expect(moved.acknowledgeMove).toHaveBeenCalled();
    const black = deps({ status: 'camera-obstructed' });
    expect(executeMcpCommand('acknowledge_alert', {}, black)).toMatchObject({ ok: true, changed: false });
    expect(black.acknowledgeMove).not.toHaveBeenCalled();
  });

  it('knows nothing destructive', () => {
    for (const command of ['delete_event', 'delete_video', 'clear_history', 'set_retention', 'change_stream_pin', 'update_configuration']) {
      expect(executeMcpCommand(command, {}, deps())).toMatchObject({ ok: false, code: 'NOVAGUARD_INVALID_ARGUMENT' });
    }
  });
});

describe('agent log', () => {
  it('is newest first and bounded', () => {
    let log = parseAgentLog(null);
    for (let i = 0; i < AGENT_LOG_LIMIT + 5; i++) log = appendAgentAction(log, { at: i, command: 'stop_surveillance', ok: true, changed: true });
    expect(log).toHaveLength(AGENT_LOG_LIMIT);
    expect(log[0].at).toBe(AGENT_LOG_LIMIT + 4);
  });

  it('reads anything unreadable as empty', () => {
    expect(parseAgentLog('not json')).toEqual([]);
    expect(parseAgentLog('{"a":1}')).toEqual([]);
    expect(parseAgentLog(JSON.stringify([{ at: 1, command: 'x', ok: true, changed: false }, { bad: true }]))).toHaveLength(1);
  });
});

describe('annotate_event', () => {
  it('leaves a verdict and a trimmed note on the event', () => {
    const d = deps();
    const outcome = executeMcpCommand('annotate_event', { eventId: 3, verdict: 'attention', note: '  Person at the gate at night.  ' }, d);
    expect(outcome).toEqual({ ok: true, changed: true, result: { eventId: 3, verdict: 'attention' } });
    expect(d.setAgentNote).toHaveBeenCalledWith(3, { verdict: 'attention', text: 'Person at the gate at night.', at: expect.any(Number) });
  });

  it('changes nothing when the same verdict and note are sent again', () => {
    const d = deps({ events: [event(3, { agentNote: { verdict: 'expected', text: 'Postman', at: 1 } })] });
    expect(executeMcpCommand('annotate_event', { eventId: 3, verdict: 'expected', note: 'Postman' }, d))
      .toMatchObject({ ok: true, changed: false });
    expect(d.setAgentNote).not.toHaveBeenCalled();
  });

  it('refuses an unknown event, an unknown verdict and an essay', () => {
    const d = deps();
    expect(executeMcpCommand('annotate_event', { eventId: 99, verdict: 'note' }, d)).toMatchObject({ ok: false, code: 'NOVAGUARD_NOT_FOUND' });
    expect(executeMcpCommand('annotate_event', { eventId: 3, verdict: 'guilty' }, d)).toMatchObject({ ok: false, code: 'NOVAGUARD_INVALID_ARGUMENT' });
    expect(executeMcpCommand('annotate_event', { eventId: 3, verdict: 'note', note: 'x'.repeat(281) }, d))
      .toMatchObject({ ok: false, code: 'NOVAGUARD_INVALID_ARGUMENT' });
    expect(d.setAgentNote).not.toHaveBeenCalled();
  });
});
