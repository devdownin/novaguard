/**
 * What the upstream guard does with a *name* rather than an address.
 *
 * `validateClientEndpoint` lets exactly one hostname through — `localhost` —
 * and that was the one the DNS check exempted itself from. Lives in its own
 * file because it replaces `dns/promises`, and no other suite should inherit
 * a resolver that answers whatever the test last set.
 */

import dns from 'dns/promises';

jest.mock('dns/promises', () => ({ __esModule: true, default: { lookup: jest.fn() } }));

const lookup = dns.lookup as unknown as jest.Mock;

// Imported after the mock so the module under test binds to it.
const { NovaGuardMcpServer } = require('../server');
const { NovaGuardReadApiClient } = require('../client/NovaGuardReadApiClient');

function guardedClient(baseUrl: string, fetchFn: jest.Mock) {
  const client = new NovaGuardReadApiClient({ baseUrl, fetchFn });
  // Constructing the server is what installs the upstream guard on the client.
  expect(new NovaGuardMcpServer({ client })).toBeDefined();
  return client;
}

const ok = (..._args: unknown[]) =>
  new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => lookup.mockReset());

it('refuses a loopback name that resolves off the device', async () => {
  // The check used to read `!loopbackHost && records.some(isBlocked)`, so a
  // loopback *name* skipped it entirely: `localhost` pointed at a LAN address
  // by a hosts file or a resolver was fetched without anything looking.
  lookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }]);
  const fetchFn = jest.fn(ok);
  const client = guardedClient('http://localhost:8099', fetchFn);

  await expect(client.getStatus()).rejects.toMatchObject({ code: 'NOVAGUARD_DEVICE_UNAVAILABLE' });
  expect(fetchFn).not.toHaveBeenCalled();
});

it('refuses a loopback name that resolves to a mix', async () => {
  // One bad record is enough: which one a connection picks is not ours to
  // choose, so every answer has to be acceptable.
  lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }, { address: '10.0.0.5', family: 4 }]);
  const fetchFn = jest.fn(ok);
  const client = guardedClient('http://localhost:8099', fetchFn);

  await expect(client.getStatus()).rejects.toMatchObject({ code: 'NOVAGUARD_DEVICE_UNAVAILABLE' });
  expect(fetchFn).not.toHaveBeenCalled();
});

it('connects to the address it checked, not to the name it checked it through', async () => {
  // Resolving again at connect time is a second lookup that can answer
  // differently — the rebinding window validation would otherwise leave open.
  lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const fetchFn = jest.fn(ok);
  const client = guardedClient('http://localhost:8099', fetchFn);

  await expect(client.getStatus()).resolves.toBeDefined();
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:8099/api/v1/status');
});

it('does not resolve an address that is already one', async () => {
  // An IP literal has nothing to look up, and a resolver that is never asked
  // cannot answer differently the second time.
  const fetchFn = jest.fn(ok);
  const client = guardedClient('http://127.0.0.1:8099', fetchFn);

  await expect(client.getStatus()).resolves.toBeDefined();
  expect(lookup).not.toHaveBeenCalled();
  expect(fetchFn.mock.calls[0][0]).toBe('http://127.0.0.1:8099/api/v1/status');
});
