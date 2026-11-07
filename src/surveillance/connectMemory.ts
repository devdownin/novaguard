import AsyncStorage from '@react-native-async-storage/async-storage';
import { AgentId, agentsFor, Where, WHERE } from './mcpConnect';
import type { TokenChoice } from './mcpClients';

/**
 * The last thing the owner connected, so the second time is one tap.
 *
 * Not a setting: it is a convenience of this screen, read only here and nothing else depends on it,
 * so it lives under its own key and a failed read is just "no memory". Whatever comes back is checked
 * against what the screen can offer now, because an agent removed since, or a hand-edited value,
 * must not open a step that does not exist.
 */
export const CONNECT_LAST_KEY = '@novaguard:connect:last:v1';

export interface LastChoice {
  where: Where;
  agent: AgentId;
  access: TokenChoice;
}

export function parseLast(raw: string | null): LastChoice | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LastChoice> | null;
    if (!value || typeof value !== 'object') return null;
    const { where, agent, access } = value;
    if (!WHERE.includes(where as Where)) return null;
    if (!agentsFor(where as Where).includes(agent as AgentId)) return null;
    if (access !== 'read' && access !== 'control') return null;
    return { where: where as Where, agent: agent as AgentId, access };
  } catch {
    return null;
  }
}

export async function loadLast(): Promise<LastChoice | null> {
  try {
    return parseLast(await AsyncStorage.getItem(CONNECT_LAST_KEY));
  } catch {
    return null;
  }
}

export async function saveLast(choice: LastChoice): Promise<void> {
  try {
    await AsyncStorage.setItem(CONNECT_LAST_KEY, JSON.stringify(choice));
  } catch {
    // Remembering is a courtesy.
  }
}
