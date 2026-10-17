import type { Settings } from '../state/types';
import type { StringKey } from '../i18n/fr';
import type { McpServerStatus } from './mcpServer';
import { CLIENT_NAMES, clientFragment, fragmentToken, MCP_CLIENTS, McpClientId, TokenChoice } from './mcpClients';
import { agentControlLive } from './mcpControl';
import { normalizeRelayUrl } from './relayAddress';
import { formatWhen } from '../utils/date';
import { t } from '../i18n';
import type { McpGrant } from './mcpServer';

/**
 * The decisions behind "Connecter un assistant".
 *
 * Kept out of the sheet so they can be tested without a screen: where an assistant
 * runs decides which address and which credential it needs, what stands in the way
 * of connecting is a single answer rather than a list, and "connected" is something
 * the phone has seen, not something it was told.
 */

export type Where = 'phone' | 'lan' | 'cloud';
export const WHERE: readonly Where[] = ['phone', 'lan', 'cloud'];

export const CLOUD_AGENTS = ['claude-ai', 'chatgpt', 'copilot-studio'] as const;
export type CloudAgent = (typeof CLOUD_AGENTS)[number];
export type AgentId = McpClientId | CloudAgent;

/** Product names are not translated. The generic JSON entry is named by the catalogue. */
const CLOUD_NAMES: Record<CloudAgent, string> = {
  'claude-ai': 'claude.ai',
  chatgpt: 'ChatGPT',
  'copilot-studio': 'Copilot Studio',
};

export function agentName(agent: AgentId): string | null {
  if (agent === 'json') return null;
  return agent in CLOUD_NAMES ? CLOUD_NAMES[agent as CloudAgent] : CLIENT_NAMES[agent as Exclude<McpClientId, 'json'>];
}

/** The assistants offered once the owner has said where theirs runs. */
export function agentsFor(where: Where): AgentId[] {
  if (where === 'cloud') return [...CLOUD_AGENTS];
  // An agent on the phone (Termux, typically) takes the same configuration as one on the Wi-Fi, minus the
  // credential: loopback reads without a token, so nothing has to be copied across but the address.
  return [...MCP_CLIENTS];
}

export const isCloudAgent = (agent: AgentId): agent is CloudAgent => (CLOUD_AGENTS as readonly string[]).includes(agent);

/** One-line instruction, in the owner's words, for what to do with the copied text. */
export const howKey = (agent: AgentId): StringKey => `connect.how.${agent}`;

// ------------------------------------------------------------------ what stands in the way

export type Fix = 'enableServer' | 'generateToken' | 'enableCloud' | 'setRelay';

export interface Blocker {
  key: StringKey;
  /** What the owner can do about it from here; none when it is a matter of waiting or of the network. */
  fix: Fix | null;
  /** Nothing is wrong, something is under way: shown calmly, not as a fault. */
  waiting: boolean;
}

type Needed = Pick<Settings, 'mcpEnabled' | 'mcpToken' | 'mcpCloudEnabled' | 'mcpRelayUrl'>;

/**
 * The one thing in the way, or null when the assistant can connect now.
 *
 * One answer, not a checklist: three red lines teach nothing the first does not,
 * and fixing them in order is exactly what the owner will do.
 */
export function blocker(where: Where, settings: Needed, status: McpServerStatus): Blocker | null {
  if (!settings.mcpEnabled) return { key: 'connect.block.serverOff', fix: 'enableServer', waiting: false };
  if (!status.running) return { key: 'connect.block.starting', fix: null, waiting: true };
  if (where === 'phone') return null;
  if (!settings.mcpToken) return { key: 'connect.block.noToken', fix: 'generateToken', waiting: false };
  if (where === 'lan') {
    // With a token the socket is on the network; no address then means the Wi-Fi is not there (or a VPN hides it).
    if (!status.ipAddress) return { key: 'connect.block.noWifi', fix: null, waiting: false };
    return null;
  }
  if (!normalizeRelayUrl(settings.mcpRelayUrl)) return { key: 'connect.block.noRelay', fix: 'setRelay', waiting: false };
  if (!settings.mcpCloudEnabled) return { key: 'connect.block.cloudOff', fix: 'enableCloud', waiting: false };
  switch (status.relayState ?? 'off') {
    case 'connected': return status.relayUrl ? null : { key: 'connect.block.relayConnecting', fix: null, waiting: true };
    case 'refused': return { key: 'connect.block.relayRefused', fix: null, waiting: false };
    case 'offline': return { key: 'connect.block.relayOffline', fix: null, waiting: false };
    default: return { key: 'connect.block.relayConnecting', fix: null, waiting: true };
  }
}

// ------------------------------------------------------------------ what to hand over

export interface Payload {
  /** The address, always. */
  url: string;
  /** What to copy: the assistant's own configuration, or the bare address for a cloud product that asks for one. */
  text: string;
  /** Whether `text` is a configuration or command rather than the bare address, for the button's label. */
  isConfiguration: boolean;
}

/**
 * What the owner copies for `agent`, or null while there is nothing to hand over.
 *
 * Reading unless the owner picked control on the access step, and only while control
 * is on and its token alive: `fragmentToken` hands out nothing otherwise, so a stale
 * choice cannot put a dead or forbidden credential on the clipboard. The cloud never
 * gets a credential from here at all, and cannot control whatever is chosen.
 */
export function payloadFor(
  agent: AgentId, where: Where, settings: Settings, status: McpServerStatus,
  access: TokenChoice = 'read', now: number = Date.now(),
): Payload | null {
  if (isCloudAgent(agent)) {
    return status.relayUrl ? { url: status.relayUrl, text: status.relayUrl, isConfiguration: false } : null;
  }
  if (where === 'phone') {
    const url = `${status.tls ? 'https' : 'http'}://127.0.0.1:${status.port}/mcp`;
    // Loopback reads without a token; only control needs one.
    return { url, text: clientFragment(agent, url, access === 'control' ? fragmentToken(settings, 'control', now) : ''), isConfiguration: true };
  }
  if (!status.url) return null;
  const token = fragmentToken(settings, access, now);
  return { url: status.url, text: clientFragment(agent, status.url, token), isConfiguration: true };
}

// ------------------------------------------------------------------ has it worked

export interface Baseline {
  requests: number;
  grants: number;
}

export const baselineOf = (status: McpServerStatus): Baseline => ({
  requests: status.requestCount,
  grants: (status.grants ?? []).length,
});

export type Progress = 'waiting' | 'authorizing' | 'connected';

/**
 * Whether the phone has seen the assistant since `baseline`.
 *
 * A request is the proof: a copied configuration proves only that the owner copied it.
 * For the cloud the sign of life that comes first is the authorization waiting for an
 * answer on this screen's own prompt, and it is named as such.
 */
export function progress(baseline: Baseline, status: McpServerStatus): Progress {
  if (status.requestCount > baseline.requests) return 'connected';
  if ((status.pendingAuthorizations ?? []).length > 0) return 'authorizing';
  return 'waiting';
}

/** Whether the access step may offer control: the same test the server applies, not a second opinion. */
export const controlOffered = (settings: Settings, now: number): boolean => agentControlLive(settings, now);

/** The line under an authorized assistant: where it comes from, when it last called, and when the owner's grant ends. */
export function grantSubtitle(grant: McpGrant): string {
  const base = { host: grant.host, time: formatWhen(grant.lastUsedAt) };
  return grant.validUntil
    ? t('setup.mcpGrants.until', { ...base, until: formatWhen(grant.validUntil) })
    : t('setup.mcpGrants.lastUsed', base);
}
