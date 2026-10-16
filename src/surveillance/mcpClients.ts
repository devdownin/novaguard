import type { Settings } from '../state/types';
import { agentControlLive } from './mcpControl';

/**
 * The configuration each agent client takes to reach this phone.
 *
 * One JSON shape used to serve every client, and it was valid for none of them:
 * no `type`, so the clients that require one refused it, and a CLI-only client
 * got a file to paste. Each fragment here is the form `docs/CONNEXION.md` §6
 * documents for that client. The three clients that call from their vendor's
 * cloud are not here at all: the phone is not reachable from there, and a
 * fragment would read as a promise that it is.
 */
export const MCP_CLIENTS = [
  'json', 'claude-code', 'librechat', 'open-webui', 'anythingllm', 'openclaw', 'hermes',
] as const;
export type McpClientId = (typeof MCP_CLIENTS)[number];

/** Product names, not translated; the generic entry is labelled by the catalogue. */
export const CLIENT_NAMES: Record<Exclude<McpClientId, 'json'>, string> = {
  'claude-code': 'Claude Code',
  librechat: 'LibreChat',
  'open-webui': 'Open WebUI',
  anythingllm: 'AnythingLLM',
  openclaw: 'OpenClaw',
  hermes: 'Hermes Agent',
};

export function nextClient(current: McpClientId): McpClientId {
  return MCP_CLIENTS[(MCP_CLIENTS.indexOf(current) + 1) % MCP_CLIENTS.length];
}

export type TokenChoice = 'read' | 'control';

/**
 * The token a fragment carries. Reading by default: the control token also
 * reads, so handing it out whenever control happened to be on gave every client
 * the owner configured the power to stop the camera. It is used only when the
 * owner asks for it, and only while it can still control.
 */
export function fragmentToken(settings: Settings, choice: TokenChoice, now: number): string {
  if (choice === 'control') return agentControlLive(settings, now) ? settings.mcpControlToken : '';
  return settings.mcpToken;
}

const bearer = (token: string) => `Bearer ${token}`;

/** A JSON object, compact enough for the QR code; `.mcp.json` and Cursor read it as is. */
export function genericConfig(url: string, token: string) {
  return {
    mcpServers: {
      novaguard: {
        type: 'http',
        url,
        headers: token ? { Authorization: bearer(token) } : {},
      },
    },
  };
}

/**
 * The text to paste into `client`. URLs and tokens are `[A-Za-z0-9_:/.]`, so the
 * double quotes below never need escaping.
 */
export function clientFragment(client: McpClientId, url: string, token: string): string {
  switch (client) {
    case 'json':
      return JSON.stringify(genericConfig(url, token), null, 2);
    case 'claude-code':
      return `claude mcp add --transport http novaguard "${url}"`
        + (token ? ` \\\n  --header "Authorization: ${bearer(token)}"` : '');
    case 'librechat':
      return [
        'mcpServers:',
        '  novaguard:',
        '    type: streamable-http',
        `    url: "${url}"`,
        '    requiresOAuth: false',
        ...(token ? ['    headers:', `      Authorization: "${bearer(token)}"`] : []),
      ].join('\n');
    case 'open-webui':
      return [`URL: ${url}`, 'Type: MCP (Streamable HTTP)', ...(token ? [`Bearer: ${token}`] : [])].join('\n');
    case 'anythingllm':
      return JSON.stringify({
        mcpServers: {
          novaguard: { type: 'streamable', url, ...(token ? { headers: { Authorization: bearer(token) } } : {}) },
        },
      }, null, 2);
    case 'openclaw':
      return `openclaw mcp add novaguard --url "${url}" --transport streamable-http`
        + (token ? ` \\\n  --header "Authorization: ${bearer(token)}"` : '');
    case 'hermes':
      return [
        'mcp_servers:',
        '  novaguard:',
        `    url: "${url}"`,
        ...(token ? ['    headers:', `      Authorization: "${bearer(token)}"`] : []),
      ].join('\n');
  }
}
