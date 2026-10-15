import type { AgentNote, AgentVerdict, DetectionEvent, Sensitivity, Settings } from '../state/types';
import type { SurveillanceStatus } from './status';
import { keptEventIds } from '../recording/library';

/**
 * What an agent may change, and nothing else.
 *
 * Each command is reversible and visible: the user sees surveillance start or
 * stop, the thresholds move, a passage marked kept, an agent's note on an event
 * (which they can clear), and every call lands in the agent log (`agentLog.ts`). Deleting an event or a clip, editing the zone,
 * the retention, a PIN or a token are deliberately absent — they are the
 * operations whose damage the owner might only discover after the fact.
 */
export const CONTROL_COMMANDS = [
  'start_surveillance', 'stop_surveillance', 'set_sensitivity', 'set_thresholds', 'keep_event', 'acknowledge_alert',
  'annotate_event',
] as const;
export type ControlCommand = typeof CONTROL_COMMANDS[number];

/** Same bounds as the sliders in Réglages → Avancé. */
export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 95;

export const AGENT_VERDICTS: readonly AgentVerdict[] = ['false_alarm', 'expected', 'attention', 'note'];
/** Room for a sentence, not for a report: it is read on a card in the history. */
export const AGENT_NOTE_MAX = 280;

export interface CommandDeps {
  monitoring: boolean;
  /** Android lets a camera foreground service start only from the foreground. */
  foreground: boolean;
  cameraPermission: boolean;
  status: SurveillanceStatus;
  settings: Settings;
  events: DetectionEvent[];
  toggleMonitoring: () => void;
  setSensitivity: (s: Sensitivity) => void;
  setThreshold: (v: number) => void;
  setAnimalThreshold: (v: number) => void;
  setKept: (eventId: number, kept: boolean) => void;
  setAgentNote: (eventId: number, note: AgentNote | null) => void;
  acknowledgeMove: () => void;
}

/**
 * The codes the native side turns into a tool result carrying `isError`; any
 * other code would surface as a protocol error the model never sees.
 */
type FailureCode = 'NOVAGUARD_INVALID_ARGUMENT' | 'NOVAGUARD_NOT_FOUND' | 'NOVAGUARD_DEVICE_UNAVAILABLE' | 'NOVAGUARD_PERMISSION_REQUIRED';

export type CommandOutcome =
  | { ok: true; changed: boolean; result: Record<string, unknown> }
  | { ok: false; code: FailureCode; message: string };

const fail = (code: FailureCode, message: string): CommandOutcome => ({ ok: false, code, message });
const done = (changed: boolean, result: Record<string, unknown> = {}): CommandOutcome => ({ ok: true, changed, result });

/** A [0,1] gate as the agent sends it, as the whole percent the settings store. */
function percentGate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(value * 100)));
}

export function executeMcpCommand(command: string, args: Record<string, unknown>, deps: CommandDeps): CommandOutcome {
  switch (command) {
    case 'start_surveillance': {
      if (deps.monitoring) return done(false, { surveillanceActive: true });
      if (!deps.cameraPermission) return fail('NOVAGUARD_PERMISSION_REQUIRED', 'Camera permission has not been granted on the device');
      if (!deps.foreground) {
        return fail('NOVAGUARD_DEVICE_UNAVAILABLE', 'Android only lets the camera start while NovaGuard is on screen; open the app on the phone, then retry');
      }
      deps.toggleMonitoring();
      return done(true, { surveillanceActive: true });
    }
    case 'stop_surveillance': {
      if (!deps.monitoring) return done(false, { surveillanceActive: false });
      deps.toggleMonitoring();
      return done(true, { surveillanceActive: false });
    }
    case 'set_sensitivity': {
      const value = args.sensitivity;
      if (value !== 'Basse' && value !== 'Moyenne' && value !== 'Haute') {
        return fail('NOVAGUARD_INVALID_ARGUMENT', 'sensitivity must be Basse, Moyenne or Haute');
      }
      if (deps.settings.sens === value) return done(false, { sensitivity: value });
      deps.setSensitivity(value);
      return done(true, { sensitivity: value });
    }
    case 'set_thresholds': {
      const person = args.person === undefined ? undefined : percentGate(args.person);
      const animal = args.animal === undefined ? undefined : percentGate(args.animal);
      if (person === null || animal === null || (person === undefined && animal === undefined)) {
        return fail('NOVAGUARD_INVALID_ARGUMENT', 'Give person and/or animal as a number in [0.5, 0.95]');
      }
      let changed = false;
      if (person !== undefined && person !== deps.settings.threshold) { deps.setThreshold(person); changed = true; }
      if (animal !== undefined && animal !== deps.settings.animalThreshold) { deps.setAnimalThreshold(animal); changed = true; }
      return done(changed, {
        person: (person ?? deps.settings.threshold) / 100,
        animal: (animal ?? deps.settings.animalThreshold) / 100,
      });
    }
    case 'keep_event': {
      const id = args.eventId;
      const kept = args.kept;
      if (typeof id !== 'number' || typeof kept !== 'boolean') {
        return fail('NOVAGUARD_INVALID_ARGUMENT', 'eventId (integer) and kept (boolean) are required');
      }
      if (!deps.events.some(e => e.id === id)) return fail('NOVAGUARD_NOT_FOUND', `Event ${id} not found`);
      const already = keptEventIds(deps.events).has(id);
      if (already === kept) return done(false, { eventId: id, kept });
      deps.setKept(id, kept);
      return done(true, { eventId: id, kept });
    }
    case 'annotate_event': {
      const id = args.eventId;
      const verdict = args.verdict;
      const text = args.note === undefined ? '' : args.note;
      if (typeof id !== 'number' || !AGENT_VERDICTS.includes(verdict as AgentVerdict) || typeof text !== 'string') {
        return fail('NOVAGUARD_INVALID_ARGUMENT', `eventId (integer) and verdict (${AGENT_VERDICTS.join(', ')}) are required; note is a string`);
      }
      if (text.length > AGENT_NOTE_MAX) return fail('NOVAGUARD_INVALID_ARGUMENT', `note is limited to ${AGENT_NOTE_MAX} characters`);
      const event = deps.events.find(e => e.id === id);
      if (!event) return fail('NOVAGUARD_NOT_FOUND', `Event ${id} not found`);
      const trimmed = text.trim();
      if (event.agentNote?.verdict === verdict && event.agentNote?.text === trimmed) return done(false, { eventId: id, verdict });
      deps.setAgentNote(id, { verdict: verdict as AgentVerdict, text: trimmed, at: Date.now() });
      return done(true, { eventId: id, verdict });
    }
    case 'acknowledge_alert': {
      if (deps.status !== 'camera-moved') return done(false, { status: deps.status });
      deps.acknowledgeMove();
      return done(true, { acknowledged: 'camera-moved' });
    }
    default:
      return fail('NOVAGUARD_INVALID_ARGUMENT', `Unknown command '${command}'`);
  }
}
