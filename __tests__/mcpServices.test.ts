/**
 * The "Services MCP" page lists what the server offers. The server's catalogue
 * is Kotlin and Java, which Jest cannot import, so their sources are read: a
 * tool added to `McpCatalog.kt` without a line on the page, or dropped from it
 * while the page still advertises it, fails here rather than on an owner's phone.
 */
import fs from 'fs';
import path from 'path';
import {
  CONTROL_TOOLS, controlAvailability, PROMPTS, READ_TOOLS, RESOURCE_URIS,
} from '../src/surveillance/mcpServices';
import { defaultSettings } from '../src/state/defaults';
import { liveFrameWanted } from '../src/surveillance/mcpControl';
import { fr } from '../src/i18n/fr';

const native = (file: string) =>
  fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/novaguard/surveillance', file), 'utf8');

const catalog = native('McpCatalog.kt');
const advertisedTools = [...catalog.matchAll(/tool\(\s*"([a-z_]+)"/g)].map(m => m[1]);
const controlBlock = catalog.slice(catalog.indexOf('val CONTROL_TOOLS'), catalog.indexOf(')', catalog.indexOf('val CONTROL_TOOLS')));
const serverControl = [...controlBlock.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);

it('lists exactly the tools the server advertises', () => {
  expect([...READ_TOOLS, ...CONTROL_TOOLS].sort()).toEqual([...advertisedTools].sort());
});

it('puts each tool on the side of the token that unlocks it', () => {
  expect([...CONTROL_TOOLS].sort()).toEqual([...serverControl].sort());
});

it('lists exactly the prompts the server offers', () => {
  const prompts = [...native('McpPrompts.java').matchAll(/new Prompt\(\s*"([a-z_]+)"/g)].map(m => m[1]);
  expect([...PROMPTS].sort()).toEqual(prompts.sort());
});

it('shows the resource URIs the server parses', () => {
  const templates = [...catalog.matchAll(/template\("([^"]+)"/g)].map(m => m[1]);
  expect(Object.values(RESOURCE_URIS).filter(uri => uri.includes('{')).sort()).toEqual(templates.sort());
  expect(catalog).toContain('"novaguard://status"');
});

it('describes every service in the owner’s language', () => {
  const keys = [
    ...[...READ_TOOLS, ...CONTROL_TOOLS].map(n => `mcpService.tool.${n}`),
    ...PROMPTS.map(n => `mcpService.prompt.${n}`),
    ...Object.keys(RESOURCE_URIS).map(n => `mcpService.resource.${n}`),
  ];
  expect(keys.filter(k => !(k in fr))).toEqual([]);
});

describe('control availability', () => {
  const on = { ...defaultSettings, mcpEnabled: true, mcpControlEnabled: true, mcpControlToken: 'mcp_x' };
  it('names the first thing in the way', () => {
    expect(controlAvailability(defaultSettings, 0)).toBe('serverOff');
    expect(controlAvailability({ ...on, mcpControlEnabled: false }, 0)).toBe('switchOff');
    expect(controlAvailability({ ...on, mcpControlToken: '' }, 0)).toBe('noToken');
    expect(controlAvailability({ ...on, mcpControlExpiresAt: 10 }, 10)).toBe('expired');
    expect(controlAvailability({ ...on, mcpControlExpiresAt: 10 }, 9)).toBe('available');
    expect(controlAvailability({ ...on, mcpControlExpiresAt: 0 }, 9e12)).toBe('available');
  });
});

describe('live view', () => {
  const allowed = { ...defaultSettings, mcpEnabled: true, mcpLiveFrameEnabled: true };
  it('offers frames only while monitoring, with the server and the owner’s switch on', () => {
    expect(liveFrameWanted(allowed, true)).toBe(true);
    expect(liveFrameWanted(allowed, false)).toBe(false);
    expect(liveFrameWanted({ ...allowed, mcpEnabled: false }, true)).toBe(false);
    expect(liveFrameWanted({ ...allowed, mcpLiveFrameEnabled: false }, true)).toBe(false);
    expect(defaultSettings.mcpLiveFrameEnabled).toBe(false);
  });

  it('is advertised by the server only behind the same switch', () => {
    expect(catalog).toMatch(/if \(liveEnabled\) list\.put\(liveTool\(\)\)/);
    expect(catalog).toMatch(/if \(operation == LIVE_TOOL\) return liveEnabled/);
  });
});
