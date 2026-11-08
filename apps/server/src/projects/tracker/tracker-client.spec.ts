import { describe, expect, it, vi } from 'vitest';
import catalog from '../../../test/fixtures/tracker/projects.json';
import blogger from '../../../test/fixtures/tracker/stats-blogger.json';
import { DEFAULT_USER_AGENT, HttpTrackerClient, TrackerError } from './tracker-client';

type Reply = { status: number; body?: unknown; throws?: Error };

function client(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const reply = replies.shift() ?? { status: 200, body: {} };
    if (reply.throws) throw reply.throws;
    return new Response(reply.body === undefined ? 'not json{' : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return {
    calls,
    client: new HttpTrackerClient({
      projectsUrl: 'http://tracker.test/projects.json',
      statsUrlTemplate: 'http://tracker.test/{name}/stats.json',
      retryDelayMs: 0,
      fetch: fetchImpl as unknown as typeof fetch,
    }),
  };
}

describe('HttpTrackerClient', () => {
  it('fetches and normalizes the catalog with a descriptive User-Agent', async () => {
    const { client: c, calls } = client([{ status: 200, body: catalog }]);
    const result = await c.fetchCatalog();
    expect(result.autoProject).toBe('telegram');
    expect(result.projects).toHaveLength(21);
    const urlteam = result.projects.find((p) => p.name === 'urlteam2')!;
    expect(urlteam).toMatchObject({
      title: 'URLTeam 2',
      leaderboard: 'https://tracker.archiveteam.org:1338/',
      deadline: null,
    });
    expect((calls[0]!.init?.headers as Record<string, string>)['user-agent']).toBe(
      DEFAULT_USER_AGENT,
    );
  });

  it('fetches stats, keeping counts and the downloader count only', async () => {
    const { client: c, calls } = client([{ status: 200, body: blogger }]);
    const stats = await c.fetchStats('blogger');
    expect(stats).toEqual({
      todo: blogger.counts.todo,
      out: blogger.counts.out,
      done: blogger.counts.done,
      rcr: blogger.counts.rcr,
      downloaderCount: blogger.downloaders.length,
    });
    expect(calls[0]!.url).toBe('http://tracker.test/blogger/stats.json');
  });

  it('retries once on a network error or a 5xx, then gives up', async () => {
    const ok = { status: 200, body: blogger };
    const { client: c, calls } = client([{ status: 0, throws: new Error('ECONNRESET') }, ok]);
    await expect(c.fetchStats('blogger')).resolves.toMatchObject({ todo: blogger.counts.todo });
    expect(calls).toHaveLength(2);

    const twice = client([
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    await expect(twice.client.fetchStats('blogger')).rejects.toMatchObject({
      name: 'TrackerError',
      status: 503,
    });
    expect(twice.calls).toHaveLength(2);
  });

  it('does not retry a 4xx', async () => {
    const { client: c, calls } = client([{ status: 404, body: {} }]);
    await expect(c.fetchStats('nope')).rejects.toBeInstanceOf(TrackerError);
    expect(calls).toHaveLength(1);
  });

  it('rejects malformed bodies', async () => {
    const notJson = client([{ status: 200 }, { status: 200 }]);
    await expect(notJson.client.fetchStats('blogger')).rejects.toThrow('not JSON');
    const wrongShape = client([{ status: 200, body: { counts: { todo: 'many' } } }]);
    await expect(wrongShape.client.fetchStats('blogger')).rejects.toThrow('unexpected shape');
    const badCatalog = client([{ status: 200, body: { projects: [{ name: '' }] } }]);
    await expect(badCatalog.client.fetchCatalog()).rejects.toThrow('unexpected shape');
  });

  it('tolerates missing optional fields', async () => {
    const { client: c } = client([
      { status: 200, body: { counts: { todo: 1, out: 2, done: 3 } } },
      { status: 200, body: { projects: [{ name: 'x', title: 'X' }] } },
    ]);
    expect(await c.fetchStats('x')).toEqual({
      todo: 1,
      out: 2,
      done: 3,
      rcr: null,
      downloaderCount: 0,
    });
    const cat = await c.fetchCatalog();
    expect(cat.autoProject).toBeNull();
    expect(cat.projects[0]).toEqual({
      name: 'x',
      title: 'X',
      description: '',
      logo: null,
      leaderboard: null,
      repository: null,
      deadline: null,
    });
  });
});
