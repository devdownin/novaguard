/**
 * The parts of MCP that decide whether a client works at all.
 *
 * Everything here was wrong in a way no test could see: the suite drove the
 * server directly with hand-written frames that happened to match what it
 * accepted, so a catalogue no client can load, a listing that returns nothing
 * fetchable, and an answer to a notification all passed.
 */

import { NovaGuardMcpServer } from '../server';
import { InMemoryNovaGuardApi, NovaGuardMockDataSource } from '../testing/inMemoryApi';
import { McpHttpServer } from '../transport/httpServer';
import { ALL_TOOLS } from '../tools';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../protocol';

const LOOPBACK = '127.0.0.1';

const mockData: NovaGuardMockDataSource = {
  surveillanceActive: true,
  camera: 'Arrière (1×)',
  lastDetectionAt: Date.now(),
  detectionsToday: 1,
  storage: { free: 100_000, total: 500_000 },
  settings: {
    camera: 'Arrière (1×)', person: true, animal: true, sens: 'Moyenne', threshold: 0.6,
    preciseDetection: false, autoZoom: true, zone: null, quality: '1080p', post: '10 s',
    max: '5 min', retention: '30 jours', autoDel: true, notif: true, notifDet: true,
  },
  events: [{
    id: 42, kind: 'Personne', timestamp: Date.now(), dur: 10, conf: 0.9,
    path: '/app/clips/42.mp4', bytes: 1_000, thumbPath: '/app/thumbs/42.jpg',
  }],
};

function makeServer() {
  return new NovaGuardMcpServer({ client: new InMemoryNovaGuardApi({ ...mockData }) });
}

const call = async (server: NovaGuardMcpServer, req: any) =>
  server.handleJsonRpcRequest(req, undefined, LOOPBACK);

describe('tool names', () => {
  it('advertises names a client will accept', () => {
    // A dot is outside `^[a-zA-Z0-9_-]{1,64}$`, the pattern applied to tool
    // names — a dotted catalogue is one no client loads, so every tool in it
    // is unreachable however well the server answers.
    const pattern = /^[a-zA-Z0-9_-]{1,64}$/;
    expect(ALL_TOOLS).toHaveLength(8);
    for (const tool of ALL_TOOLS) expect(tool.name).toMatch(pattern);
  });

  it('still answers to the dotted names the specification document uses', async () => {
    const server = makeServer();
    for (const name of ['novaguard_get_status', 'novaguard.get_status']) {
      const res = (await call(server, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }))!;
      expect(res.error).toBeUndefined();
      expect(res.result.isError).toBe(false);
    }
  });

  it('does not accept a bare operation name', async () => {
    // The prefix is part of the contract; stripping it in `toolOperation`
    // must not turn the server into one that answers to anything.
    const res = (await call(makeServer(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_status', arguments: {} } }))!;
    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32602);
  });
});

describe('protocol negotiation', () => {
  it('echoes every version it supports', async () => {
    const server = makeServer();
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      const res = (await call(server, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'c', version: '1' } },
      }))!;
      expect(res.result.protocolVersion).toBe(version);
    }
  });

  it('offers its newest for a version it does not know', async () => {
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
    }))!;
    expect(res.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe('notifications', () => {
  it('are never answered', async () => {
    // `notifications/initialized` is the first frame after the handshake, so a
    // server that answers it desynchronises every conforming client at once.
    for (const method of ['notifications/initialized', 'notifications/cancelled']) {
      expect(await call(makeServer(), { jsonrpc: '2.0', method })).toBeNull();
    }
  });

  it('are recognised by the absence of an id, not by their method name', async () => {
    expect(await call(makeServer(), { jsonrpc: '2.0', method: 'tools/list' })).toBeNull();
    expect(await call(makeServer(), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).not.toBeNull();
  });

  it('get no error response either, malformed or not', async () => {
    expect(await call(makeServer(), { jsonrpc: '2.0', method: 'no/such/method' })).toBeNull();
    expect(await call(makeServer(), { jsonrpc: '1.0', method: 'tools/list' } as any)).toBeNull();
  });

  it('an explicit null id is a request, and is answered', async () => {
    // JSON-RPC distinguishes an absent id from a null one. Only the first is
    // a notification.
    const res = await call(makeServer(), { jsonrpc: '2.0', id: null, method: 'tools/list' });
    expect(res).not.toBeNull();
    expect(res!.id).toBeNull();
  });
});

describe('resource listings', () => {
  it('resources/list returns things that can be fetched', async () => {
    const res = (await call(makeServer(), { jsonrpc: '2.0', id: 1, method: 'resources/list' }))!;
    const resources = res.result.resources;
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      expect(typeof resource.uri).toBe('string');
      expect(resource.uri).not.toContain('{');
      expect(resource.uriTemplate).toBeUndefined();
    }
  });

  it('every listed resource actually reads', async () => {
    // A listing is a promise. One naming a URI the server then refuses is
    // worse than no listing at all.
    const server = makeServer();
    const listed = (await call(server, { jsonrpc: '2.0', id: 1, method: 'resources/list' }))!.result.resources;
    for (const resource of listed) {
      const read = (await call(server, { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: resource.uri } }))!;
      expect(read.error).toBeUndefined();
    }
  });

  it('resources/templates/list carries the templated shapes', async () => {
    const res = (await call(makeServer(), { jsonrpc: '2.0', id: 1, method: 'resources/templates/list' }))!;
    const templates = res.result.resourceTemplates;
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(template.uriTemplate).toContain('{');
      expect(template.uri).toBeUndefined();
    }
  });
});

describe('the error model', () => {
  it('a tool that ran and failed answers with isError, not a JSON-RPC error', async () => {
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'novaguard_get_event', arguments: { eventId: 9999 } },
    }))!;
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('NOVAGUARD_NOT_FOUND');
  });

  it('a successful call says so, and carries structured content', async () => {
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'novaguard_get_event', arguments: { eventId: 42 } },
    }))!;
    expect(res.result.isError).toBe(false);
    expect(res.result.structuredContent.id).toBe(42);
  });

  it('omits structuredContent for a tool whose payload is a list', async () => {
    // The field is specified as an object; handing a client an array there is
    // a shape its own schema rejects.
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'novaguard_get_latest_events', arguments: { limit: 1 } },
    }))!;
    expect(res.result.isError).toBe(false);
    expect(res.result.structuredContent).toBeUndefined();
    expect(JSON.parse(res.result.content[0].text)).toHaveLength(1);
  });

  it('an unknown method is -32601 and an unknown tool is -32602', async () => {
    // Two different faults that used to share a code: telling a client the
    // *method* is missing when it named a tool sends it looking for a broken
    // server rather than at its own tool name.
    const method = (await call(makeServer(), { jsonrpc: '2.0', id: 1, method: 'no/such/method' }))!;
    expect(method.error?.code).toBe(-32601);

    const tool = (await call(makeServer(), {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'novaguard_no_such_tool', arguments: {} },
    }))!;
    expect(tool.result).toBeUndefined();
    expect(tool.error?.code).toBe(-32602);
  });

  it('a resource that cannot be produced is -32002', async () => {
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'novaguard://video/9999' },
    }))!;
    expect(res.error?.code).toBe(-32002);
  });

  it('a mutating operation stays a protocol error, never a tool result', async () => {
    // Nothing ran and nothing a caller sends would change that, so it is not
    // an outcome the model should be invited to work around.
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'novaguard.delete_event', arguments: {} },
    }))!;
    expect(res.result).toBeUndefined();
    expect(res.error?.message).toContain('NOVAGUARD_INVALID_ARGUMENT');
  });
});

describe('argument validation', () => {
  const badArguments: Array<[string, Record<string, unknown>, string]> = [
    ['unknown key', { bogus: 1 }, "Unknown argument 'bogus'"],
    ['misspelled filter', { minconfidence: 0.5 }, "Unknown argument 'minconfidence'"],
    ['value outside an enum', { sort: 'DROP TABLE' }, "must be one of"],
    ['wrong type', { minConfidence: 'abc' }, 'must be a number'],
    ['below a minimum', { limit: 0 }, 'must be at least 1'],
    ['above a maximum', { limit: 101 }, 'must be at most 100'],
    ['a float where an integer is declared', { offset: 1.5 }, 'must be an integer'],
  ];

  it.each(badArguments)('refuses %s', async (_label, args, message) => {
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'novaguard_search_events', arguments: args },
    }))!;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain(message);
  });

  it('refuses a missing required parameter', async () => {
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'novaguard_get_statistics', arguments: { from: new Date().toISOString() } },
    }))!;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('Missing required parameter to');
  });

  it('accepts every argument the advertised schema declares', async () => {
    // The other half of the rule: a validator that rejects what the catalogue
    // promises is worse than none, and it is the failure a hand-maintained
    // table beside the schema drifts into.
    const res = (await call(makeServer(), {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'novaguard_search_events',
        arguments: { kind: 'Personne', minConfidence: 0.5, hasVideo: true, limit: 10, offset: 0, sort: 'timestamp_asc' },
      },
    }))!;
    expect(res.result.isError).toBe(false);
  });
});

describe('the HTTP transport', () => {
  let http: McpHttpServer;
  const port = 18181;

  beforeAll(async () => {
    http = new McpHttpServer({ port, server: makeServer() });
    await http.start();
  });

  afterAll(async () => { await http.stop(); });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('acknowledges a notification with 202 and an empty body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('answers a request with 200 and the negotiated version header', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-protocol-version')).toBe(LATEST_PROTOCOL_VERSION);
    expect((await res.json() as any).result.tools).toHaveLength(8);
  });

  it('reports a failed tool call as HTTP 200, because the call itself succeeded', async () => {
    const res = await post({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'novaguard_get_event', arguments: { eventId: 9999 } },
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).result.isError).toBe(true);
  });

  it('serves /status now that the umbrella scope exists', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    expect(res.status).toBe(200);
  });
});
