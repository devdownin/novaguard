/**
 * What agents did to this camera, newest first.
 *
 * A control plane the owner cannot audit is one they have to trust blindly:
 * every control call — refused ones included — is written here and shown in
 * Réglages → Serveur MCP, and survives a restart.
 */
export interface AgentAction {
  at: number;
  command: string;
  ok: boolean;
  /** `changed: false` when the call asked for what was already the case. */
  changed: boolean;
}

export const AGENT_LOG_KEY = '@novaguard:agentLog:v1';
export const AGENT_LOG_LIMIT = 50;

export function appendAgentAction(log: readonly AgentAction[], action: AgentAction): AgentAction[] {
  return [action, ...log].slice(0, AGENT_LOG_LIMIT);
}

/** Anything unreadable becomes an empty log rather than an error: it only ever displays. */
export function parseAgentLog(raw: string | null): AgentAction[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(a => a && typeof a.at === 'number' && typeof a.command === 'string').slice(0, AGENT_LOG_LIMIT);
  } catch {
    return [];
  }
}
