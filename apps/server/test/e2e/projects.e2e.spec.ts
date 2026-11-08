import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ProjectHistory,
  ProjectSummary,
  RefreshResult,
  ServerMessage,
} from '@ramesses/shared';
import { bootTestApp } from '../support/app';
import { FakeTracker } from '../support/fake-tracker';

let app: NestFastifyApplication | undefined;
let tracker: FakeTracker | undefined;

const until = async <T>(fn: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

beforeAll(async () => {
  tracker = await new FakeTracker().start();
  ({ app } = await bootTestApp({
    PROJECTS_SAMPLING_ENABLED: 'true',
    PROJECTS_REFRESH_MIN_SEC: '0',
    TRACKER_PROJECTS_URL: tracker.projectsUrl,
    TRACKER_STATS_URL_TEMPLATE: tracker.statsUrlTemplate,
  }));
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await tracker?.stop();
});

describe('projects end to end', () => {
  it('elects itself leader, samples on request, serves summaries, and throttles the next request', async () => {
    const health = await until(async () => {
      const res = await app!.inject({ method: 'GET', url: '/api/health/ready' });
      const body = res.json<{ info: Record<string, { leader?: boolean }> }>();
      return body.info.leader?.leader ? body : null;
    });
    expect(health.info.leader).toMatchObject({ leader: true });

    // The lone replica samples on election; wait for the catalog to land.
    const summaries = await until(async () => {
      const res = await app!.inject({ method: 'GET', url: '/api/projects' });
      const list = res.json<ProjectSummary[]>();
      return list.length > 0 &&
        list.every((p) => p.tracker !== 'universal' || p.latest || p.lastError)
        ? list
        : null;
    });
    expect(summaries.map((p) => p.name)).toContain('blogger');
    const blogger = summaries.find((p) => p.name === 'blogger')!;
    expect(blogger.latest?.todo).toBe(tracker!.counts.get('blogger')!.todo);
    expect(blogger.health).toBe('unknown'); // one sample is never enough to judge
    expect(summaries.find((p) => p.name === 'urlteam2')).toMatchObject({
      tracker: 'terroroftinytown',
      latest: null,
    });

    const detail = await app!.inject({ method: 'GET', url: '/api/projects/blogger' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<ProjectSummary>().title).toBe('Blogger');

    const history = await app!.inject({
      method: 'GET',
      url: '/api/projects/blogger/history?range=7d',
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<ProjectHistory>()).toMatchObject({ range: '7d', resolution: 'hourly' });
    expect(history.json<ProjectHistory>().points).toHaveLength(1);

    const badRange = await app!.inject({
      method: 'GET',
      url: '/api/projects/blogger/history?range=1y',
    });
    expect(badRange.statusCode).toBe(400);
    const missing = await app!.inject({ method: 'GET', url: '/api/projects/nope' });
    expect(missing.statusCode).toBe(404);

    // With the throttle set to zero, a manual refresh runs straight away.
    const refresh = await app!.inject({ method: 'POST', url: '/api/projects/refresh' });
    expect(refresh.statusCode).toBe(202);
    const result = refresh.json<RefreshResult>();
    expect(result.requested).toBe(true);
    expect(result.lastRunAt).not.toBeNull();

    const hidden = await app!.inject({ method: 'GET', url: '/api/projects?includeHidden=true' });
    expect(hidden.json<ProjectSummary[]>().length).toBeGreaterThanOrEqual(summaries.length);
    const badQuery = await app!.inject({ method: 'GET', url: '/api/projects?includeHidden=maybe' });
    expect(badQuery.statusCode).toBe(400);
  });

  it('puts the catalog in hello and pushes a projects message after each sample run', async () => {
    const { port } = app!.getHttpServer().address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerMessage[] = [];
    const waitFor = <T extends ServerMessage>(
      test: (m: ServerMessage) => m is T,
      timeoutMs = 10_000,
    ) =>
      new Promise<T>((resolve, reject) => {
        const found = messages.find(test);
        if (found) return resolve(found);
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for message')),
          timeoutMs,
        );
        const onMessage = (data: unknown) => {
          const message = JSON.parse(String(data)) as ServerMessage;
          if (test(message)) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(message);
          }
        };
        ws.on('message', onMessage);
      });
    ws.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    try {
      const hello = await waitFor(
        (m): m is Extract<ServerMessage, { type: 'hello' }> => m.type === 'hello',
      );
      expect(hello.projects.map((p) => p.name)).toContain('blogger');
      expect(hello.projects.find((p) => p.name === 'blogger')?.latest).not.toBeNull();

      tracker!.advance('blogger', { done: 500 });
      const refresh = await app!.inject({ method: 'POST', url: '/api/projects/refresh' });
      expect(refresh.json<RefreshResult>().requested).toBe(true);
      const pushed = await waitFor(
        (m): m is Extract<ServerMessage, { type: 'projects' }> =>
          m.type === 'projects' &&
          m.projects.find((p) => p.name === 'blogger')?.latest?.done ===
            tracker!.counts.get('blogger')!.done,
      );
      expect(pushed.projects.length).toBeGreaterThan(1);
    } finally {
      ws.close();
    }
  });
});
