import {
  agentsFor, baselineOf, blocker, CLOUD_AGENTS, controlOffered, grantSubtitle, isCloudAgent, payloadFor, progress, WHERE,
} from '../src/surveillance/mcpConnect';
import { MCP_SERVER_STOPPED, McpServerStatus } from '../src/surveillance/mcpServer';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

const token = 'mcp_' + 'r'.repeat(32);
const relay = 'https://relay.example.org';
const settings = (over: Partial<Settings> = {}): Settings => ({
  ...defaultSettings, mcpEnabled: true, mcpToken: token, mcpCloudEnabled: true, mcpRelayUrl: relay, ...over,
});
const status = (over: Partial<McpServerStatus> = {}): McpServerStatus => ({
  ...MCP_SERVER_STOPPED, running: true, ipAddress: '192.168.1.42', url: 'http://192.168.1.42:8081/mcp',
  hasToken: true, loopbackOnly: false, relayState: 'connected', relayUrl: `${relay}/d/abc/mcp`, ...over,
});

describe('blocker', () => {
  it('names the first thing in the way, in the order the owner will fix it', () => {
    expect(blocker('lan', settings({ mcpEnabled: false }), status())).toMatchObject({ fix: 'enableServer' });
    expect(blocker('lan', settings(), status({ running: false }))).toMatchObject({ waiting: true, fix: null });
    expect(blocker('lan', settings({ mcpToken: '' }), status())).toMatchObject({ fix: 'generateToken' });
    expect(blocker('lan', settings(), status({ ipAddress: null }))).toMatchObject({ key: 'connect.block.noWifi' });
    expect(blocker('cloud', settings({ mcpRelayUrl: '' }), status())).toMatchObject({ fix: 'setRelay' });
    expect(blocker('cloud', settings({ mcpCloudEnabled: false }), status())).toMatchObject({ fix: 'enableCloud' });
  });
  it('lets a local application in without a token', () => {
    expect(blocker('phone', settings({ mcpToken: '' }), status())).toBeNull();
  });
  it('reads the relay state rather than assuming the switch means connected', () => {
    expect(blocker('cloud', settings(), status())).toBeNull();
    expect(blocker('cloud', settings(), status({ relayState: 'connecting' }))).toMatchObject({ waiting: true });
    expect(blocker('cloud', settings(), status({ relayState: 'connected', relayUrl: null }))).toMatchObject({ waiting: true });
    expect(blocker('cloud', settings(), status({ relayState: 'refused' }))).toMatchObject({ key: 'connect.block.relayRefused' });
    expect(blocker('cloud', settings(), status({ relayState: 'offline' }))).toMatchObject({ key: 'connect.block.relayOffline' });
  });
});

describe('payloadFor', () => {
  it('hands a cloud product the public address and nothing secret', () => {
    const payload = payloadFor('claude-ai', 'cloud', settings(), status())!;
    expect(payload.text).toBe(`${relay}/d/abc/mcp`);
    expect(payload.text).not.toContain(token);
    expect(payload.isConfiguration).toBe(false);
  });
  it('has nothing to hand over before the relay has an address', () => {
    expect(payloadFor('chatgpt', 'cloud', settings(), status({ relayUrl: null }))).toBeNull();
  });
  it('gives every client of a phone-local agent its own configuration on the loopback address, with no credential', () => {
    for (const agent of agentsFor('phone')) {
      const payload = payloadFor(agent, 'phone', settings(), status({ port: 8081 }))!;
      expect(payload.text).toContain('127.0.0.1:8081/mcp');
      expect(payload.text).not.toContain(token);
      expect(payload.text).not.toMatch(/Bearer/);
    }
    expect(payloadFor('claude-code', 'phone', settings(), status())!.text).toMatch(/^claude mcp add --transport http novaguard /);
  });
  it('gives a local application the loopback address without a token', () => {
    const payload = payloadFor('json', 'phone', settings(), status({ port: 8081 }))!;
    expect(payload.url).toBe('http://127.0.0.1:8081/mcp');
    expect(payload.text).not.toContain(token);
  });
  it('gives a machine on the Wi-Fi the LAN address and the read token', () => {
    const payload = payloadFor('claude-code', 'lan', settings(), status())!;
    expect(payload.text).toContain('http://192.168.1.42:8081/mcp');
    expect(payload.text).toContain(token);
  });
  describe('access', () => {
    const control = 'mcp_' + 'k'.repeat(32);
    const now = 1_760_000_000_000;
    const live = settings({ mcpControlToken: control, mcpControlEnabled: true, mcpControlExpiresAt: now + 60_000 });
    it('puts the control token on the clipboard only when control was chosen', () => {
      expect(payloadFor('json', 'lan', live, status(), 'read', now)!.text).not.toContain(control);
      expect(payloadFor('json', 'lan', live, status(), 'control', now)!.text).toContain(control);
    });
    it('hands out nothing for control once it has expired or been switched off', () => {
      const expired = settings({ ...live, mcpControlExpiresAt: now - 1 });
      const text = payloadFor('json', 'lan', expired, status(), 'control', now)!.text;
      expect(text).not.toContain(control);
      expect(controlOffered(expired, now)).toBe(false);
      expect(controlOffered(live, now)).toBe(true);
    });
    it('gives a local application a token only for control', () => {
      expect(payloadFor('json', 'phone', live, status(), 'read', now)!.text).not.toMatch(/Bearer/);
      expect(payloadFor('json', 'phone', live, status(), 'control', now)!.text).toContain(control);
    });
    it('never gives a cloud product a credential, whatever was chosen', () => {
      expect(payloadFor('claude-ai', 'cloud', live, status(), 'control', now)!.text).not.toContain(control);
    });
  });
});

describe('progress', () => {
  it('counts only requests made after the baseline', () => {
    const before = status({ requestCount: 7 });
    const base = baselineOf(before);
    expect(progress(base, before)).toBe('waiting');
    expect(progress(base, status({ requestCount: 8 }))).toBe('connected');
  });
  it('says authorizing while an assistant waits for the owner, and connected wins over it', () => {
    const base = baselineOf(status());
    const pending = [{ id: 'a', clientName: 'Claude', host: 'claude.ai', code: '1234', expiresAt: 1 }];
    expect(progress(base, status({ pendingAuthorizations: pending }))).toBe('authorizing');
    expect(progress(base, status({ pendingAuthorizations: pending, requestCount: 1 }))).toBe('connected');
  });
});

describe('grantSubtitle', () => {
  const grant = { id: 'g', clientName: 'Claude', host: 'claude.ai', createdAt: 1, lastUsedAt: 1_760_000_000_000 };
  it('names the end only when the owner chose one', () => {
    expect(grantSubtitle(grant)).toContain('claude.ai');
    expect(grantSubtitle(grant)).not.toMatch(/prend fin|ends/);
    expect(grantSubtitle({ ...grant, validUntil: 1_760_086_400_000 })).toMatch(/prend fin|ends/);
    expect(grantSubtitle({ ...grant, validUntil: 0 })).not.toMatch(/prend fin|ends/);
  });
});

describe('agentsFor', () => {
  it('offers cloud products only for the cloud, and every client for the Wi-Fi', () => {
    expect(agentsFor('cloud')).toEqual([...CLOUD_AGENTS]);
    expect(agentsFor('phone')).toEqual(agentsFor('lan'));
    for (const agent of agentsFor('lan')) expect(isCloudAgent(agent)).toBe(false);
    expect(WHERE).toEqual(['phone', 'lan', 'cloud']);
  });
});
