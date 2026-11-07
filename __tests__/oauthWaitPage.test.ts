/**
 * The script the owner's browser runs while an assistant waits for their answer
 * on the phone. It lives in `res/raw`, so no Kotlin compiler or Jest suite would
 * otherwise ever execute it: it is run here against a fake page.
 *
 * @format
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const source = readFileSync(join(__dirname, '../android/app/src/main/res/raw/mcp_oauth_wait.js'), 'utf8');

type Reply = { status: string; redirect?: string };

/** Runs the script for request `id` against server answers `replies`, one per poll. */
async function run(id: string, replies: Array<Reply | 'network-error'>) {
  const fetched: string[] = [];
  const timers: Array<{ run: () => void; delay: number }> = [];
  const redirects: string[] = [];
  const status = { textContent: '' };
  let next = 0;
  const context = {
    document: { getElementById: (name: string) => (name === 's' ? status : null) },
    fetch: (url: string) => {
      fetched.push(url);
      const reply = replies[Math.min(next++, replies.length - 1)];
      return reply === 'network-error'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ json: () => Promise.resolve(reply) });
    },
    setTimeout: (callback: () => void, delay: number) => { timers.push({ run: callback, delay }); },
    location: { replace: (url: string) => { redirects.push(url); } },
  };
  vm.runInNewContext(source.replace('__ID__', id), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { fetched, timers, redirects, status, settle };
}

describe('the confirmation page script', () => {
  it('has exactly one place for the request id, and nothing that evaluates text', () => {
    expect(source.match(/__ID__/g)).toHaveLength(1);
    expect(source).not.toMatch(/\beval\(|new Function|innerHTML|document\.write/);
  });

  it('asks about its own request and keeps asking while the owner has not answered', async () => {
    const page = await run('nvp_abc', [{ status: 'waiting' }]);
    expect(page.fetched).toEqual(['authorize/status?id=nvp_abc']);
    expect(page.timers).toHaveLength(1);
    expect(page.timers[0].delay).toBe(1500);
    expect(page.redirects).toEqual([]);

    page.timers[0].run();
    await page.settle();
    expect(page.fetched).toHaveLength(2);
  });

  it('goes where it is told, once the owner has answered', async () => {
    const page = await run('nvp_abc', [{ status: 'approved', redirect: 'https://claude.ai/cb?code=nvc_x&state=s' }]);
    expect(page.redirects).toEqual(['https://claude.ai/cb?code=nvc_x&state=s']);
    expect(page.timers).toHaveLength(0);
  });

  it('follows a refusal back to the client, too', async () => {
    const page = await run('nvp_abc', [{ status: 'denied', redirect: 'https://claude.ai/cb?error=access_denied' }]);
    expect(page.redirects).toEqual(['https://claude.ai/cb?error=access_denied']);
  });

  it('says so when the request has expired, and goes nowhere', async () => {
    const page = await run('nvp_abc', [{ status: 'expired' }]);
    expect(page.redirects).toEqual([]);
    expect(page.status.textContent).toMatch(/expirée/);
    expect(page.timers).toHaveLength(0);
  });

  it('keeps trying through a network error, more slowly', async () => {
    const page = await run('nvp_abc', ['network-error']);
    expect(page.timers).toHaveLength(1);
    expect(page.timers[0].delay).toBe(3000);
  });
});
