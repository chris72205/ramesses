import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WarriorControlClient, WarriorControlError } from './warrior-control-client';

const address = { host: '10.0.0.5', port: 8001 };
const fragment = readFileSync(
  path.resolve(__dirname, '../../test/fixtures/warrior/settings.html'),
  'utf8',
);
const errorFragment = readFileSync(
  path.resolve(__dirname, '../../test/fixtures/warrior/settings-error.html'),
  'utf8',
);

type Call = { url: string; init: RequestInit };

function client(
  responses: Array<Response | Error>,
  options: ConstructorParameters<typeof WarriorControlClient>[0] = {},
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no response scripted');
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    calls,
    client: new WarriorControlClient({
      fetch: fetchImpl as unknown as typeof fetch,
      retryDelayMs: 0,
      ...options,
    }),
  };
}

const ok = () => new Response('OK', { status: 200 });
const refused = () =>
  Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') });

describe('WarriorControlClient', () => {
  it('posts select-project as a url-encoded form and accepts OK', async () => {
    const { client: c, calls } = client([ok()]);
    await c.selectProject(address, 'telegram');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://10.0.0.5:8001/api/select-project');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe('project_name=telegram');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(headers['user-agent']).toMatch(/^ramesses\//);
    expect(headers.authorization).toBeUndefined();
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('posts deselect-project with an empty form', async () => {
    const { client: c, calls } = client([ok()]);
    await c.deselectProject(address);
    expect(calls[0]!.url).toBe('http://10.0.0.5:8001/api/deselect-project');
    expect(calls[0]!.init.body).toBe('');
  });

  it('treats a 200 without OK as an unrecognized command', async () => {
    const { client: c } = client([new Response('', { status: 200 })]);
    await expect(c.deselectProject(address)).rejects.toMatchObject({
      kind: 'unexpected_body',
      message: expect.stringContaining('empty body') as unknown,
    });
    const { client: c2 } = client([new Response('<html>nope</html>', { status: 200 })]);
    await expect(c2.deselectProject(address)).rejects.toMatchObject({ kind: 'unexpected_body' });
  });

  it('retries once when no response arrived, then reports unreachable', async () => {
    const { client: c, calls } = client([refused(), ok()]);
    await c.deselectProject(address);
    expect(calls).toHaveLength(2);

    const { client: failing, calls: failingCalls } = client([refused(), refused()]);
    const error = await failing.deselectProject(address).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WarriorControlError);
    expect(error).toMatchObject({ kind: 'unreachable', message: 'ECONNREFUSED' });
    expect(failingCalls).toHaveLength(2);
  });

  it('describes a timeout and does not retry after an HTTP answer', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    const { client: c } = client([timeout, timeout]);
    await expect(c.deselectProject(address)).rejects.toMatchObject({
      kind: 'unreachable',
      message: 'no response within the timeout',
    });
    const { client: rejected, calls } = client([new Response('boom', { status: 500 })]);
    await expect(rejected.deselectProject(address)).rejects.toMatchObject({
      kind: 'rejected',
      status: 500,
    });
    expect(calls).toHaveLength(1);
  });

  it('maps 401 to unauthorized and sends credentials when a provider has them', async () => {
    const { client: c } = client([new Response('401 Authentication Required', { status: 401 })]);
    await expect(c.deselectProject(address)).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    });
    const { client: withAuth, calls } = client([ok()], {
      credentials: () => ({ username: 'me', password: 's3cret' }),
    });
    await withAuth.deselectProject(address);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('me:s3cret').toString('base64')}`);
  });

  it('reads settings from the fragment', async () => {
    const { client: c, calls } = client([new Response(fragment, { status: 200 })]);
    expect(await c.readSettings(address)).toEqual({ downloader: 'example', concurrentItems: 3 });
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.url).toBe('http://10.0.0.5:8001/api/settings');
  });

  it('posts only the given settings and reports rejections from the fragment', async () => {
    const { client: c, calls } = client([new Response(fragment, { status: 200 })]);
    const result = await c.updateSettings(address, { concurrent_items: '3' });
    expect(calls[0]!.init.body).toBe('concurrent_items=3');
    expect(result).toEqual({
      ok: true,
      errors: {},
      settings: { downloader: 'example', concurrentItems: 3 },
    });

    const { client: rejecting } = client([new Response(errorFragment, { status: 200 })]);
    const rejected = await rejecting.updateSettings(address, { concurrent_items: '7' });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors).toEqual({ concurrent_items: 'Number must be 6 or smaller.' });
  });
});
