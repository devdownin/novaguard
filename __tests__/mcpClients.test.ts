import { clientFragment, fragmentToken, genericConfig, MCP_CLIENTS, McpClientId, nextClient } from '../src/surveillance/mcpClients';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

const url = 'http://192.168.1.42:8081/mcp';
const read = 'mcp_' + 'r'.repeat(32);
const control = 'mcp_' + 'k'.repeat(32);
const now = 1_760_000_000_000;
const settings = (over: Partial<Settings> = {}): Settings => ({
  ...defaultSettings, mcpEnabled: true, mcpToken: read,
  mcpControlEnabled: true, mcpControlToken: control, mcpControlExpiresAt: now + 3_600_000, ...over,
});

describe('fragmentToken', () => {
  it('hands out the read token unless control is asked for', () => {
    expect(fragmentToken(settings(), 'read', now)).toBe(read);
    expect(fragmentToken(settings(), 'control', now)).toBe(control);
  });
  it('never hands out a control token that cannot control', () => {
    expect(fragmentToken(settings({ mcpControlExpiresAt: now - 1 }), 'control', now)).toBe('');
    expect(fragmentToken(settings({ mcpControlEnabled: false }), 'control', now)).toBe('');
  });
});

describe('clientFragment', () => {
  it('gives every client the URL and the token', () => {
    for (const client of MCP_CLIENTS) {
      const text = clientFragment(client, url, read);
      expect(text).toContain(url);
      expect(text).toContain(read);
    }
  });
  it('leaves the header out when there is no token', () => {
    for (const client of MCP_CLIENTS) expect(clientFragment(client, url, '')).not.toMatch(/Bearer/);
  });
  it('declares the transport the clients that need one look for', () => {
    expect(genericConfig(url, read).mcpServers.novaguard).toEqual({
      type: 'http', url, headers: { Authorization: `Bearer ${read}` },
    });
    expect(clientFragment('claude-code', url, read)).toMatch(/^claude mcp add --transport http novaguard /);
    expect(clientFragment('librechat', url, read)).toContain('type: streamable-http');
    expect(clientFragment('openclaw', url, read)).toContain('--transport streamable-http');
  });
  it('turns OAuth off where a 401 would otherwise start a discovery the server cannot answer', () => {
    expect(clientFragment('librechat', url, read)).toContain('requiresOAuth: false');
    expect(clientFragment('hermes', url, read)).not.toMatch(/oauth/i);
  });
  it('writes JSON that parses', () => {
    expect(JSON.parse(clientFragment('json', url, read)).mcpServers.novaguard.url).toBe(url);
    expect(JSON.parse(clientFragment('anythingllm', url, read)).mcpServers.novaguard.headers.Authorization)
      .toBe(`Bearer ${read}`);
  });
});

it('cycles through every client and back', () => {
  let client: McpClientId = MCP_CLIENTS[0];
  const seen = new Set<string>();
  for (let i = 0; i < MCP_CLIENTS.length; i++) { seen.add(client); client = nextClient(client); }
  expect(seen.size).toBe(MCP_CLIENTS.length);
  expect(client).toBe(MCP_CLIENTS[0]);
});
