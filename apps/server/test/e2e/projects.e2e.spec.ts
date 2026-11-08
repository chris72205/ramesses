import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectHistory, ProjectSummary, RefreshResult } from '@ramesses/shared';
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
    TRACKER_PROJECTS_URL: tracker.projectsUrl,
    TRACKER_STATS_URL_TEMPLATE: tracker.statsUrlTemplate,
  }));
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

    // The run just happened, so a manual refresh is throttled.
    const refresh = await app!.inject({ method: 'POST', url: '/api/projects/refresh' });
    expect(refresh.statusCode).toBe(202);
    const result = refresh.json<RefreshResult>();
    expect(result.requested).toBe(false);
    expect(result.lastRunAt).not.toBeNull();
    expect(new Date(result.nextAllowedAt!).getTime()).toBeGreaterThan(Date.now());

    const hidden = await app!.inject({ method: 'GET', url: '/api/projects?includeHidden=true' });
    expect(hidden.json<ProjectSummary[]>().length).toBeGreaterThanOrEqual(summaries.length);
    const badQuery = await app!.inject({ method: 'GET', url: '/api/projects?includeHidden=maybe' });
    expect(badQuery.statusCode).toBe(400);
  });
});
