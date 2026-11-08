import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectHistory, ProjectSummary } from '@ramesses/shared';
import { ProjectsSampler } from '../../src/projects/projects-sampler.service';
import { ProjectsService } from '../../src/projects/projects.service';
import { bootTestApp } from '../support/app';
import { FakeTracker } from '../support/fake-tracker';
import { truncateAll } from '../support/test-db';

let app: NestFastifyApplication;
let databaseUrl: string;
let tracker: FakeTracker;
let sampler: ProjectsSampler;
let service: ProjectsService;

const T0 = new Date('2026-11-07T10:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  tracker = await new FakeTracker().start();
  ({ app, databaseUrl } = await bootTestApp({
    TRACKER_PROJECTS_URL: tracker.projectsUrl,
    TRACKER_STATS_URL_TEMPLATE: tracker.statsUrlTemplate,
    PROJECTS_RETENTION_DAYS: '1',
  }));
  sampler = app.get(ProjectsSampler);
  service = app.get(ProjectsService);
});

afterAll(async () => {
  await app?.close();
  await tracker?.stop();
});

beforeEach(async () => {
  await truncateAll(databaseUrl);
  tracker.reset();
});

describe('ProjectsSampler against Postgres and a fake tracker', () => {
  it('stores the catalog, samples universal projects, and records failures per project', async () => {
    // Only blogger and telegram have stats on the fake; every other universal project 404s.
    const result = await sampler.runOnce(T0);
    expect(result).toMatchObject({ catalog: 21, sampled: 2, pruned: 0 });
    expect(result.failed).toBe(21 - 2 - 1); // minus the two sampled and URLTeam (not universal)

    const projects = await query<{
      name: string;
      tracker: string;
      is_auto: boolean;
      listed: boolean;
      active: boolean;
      last_error: string | null;
      last_sampled_at: Date | null;
    }>(
      'SELECT name, tracker, is_auto, listed, active, last_error, last_sampled_at FROM projects ORDER BY name',
    );
    expect(projects).toHaveLength(21);
    expect(projects.find((p) => p.name === 'urlteam2')).toMatchObject({
      tracker: 'terroroftinytown',
      last_sampled_at: null,
      last_error: null,
    });
    expect(projects.find((p) => p.name === 'telegram')).toMatchObject({
      tracker: 'universal',
      is_auto: true,
      listed: true,
      active: true,
      last_error: null,
    });
    expect(projects.find((p) => p.name === 'youtube')?.last_error).toMatch(/HTTP 404/);
    expect(projects.filter((p) => p.is_auto)).toHaveLength(1);

    const stats = await query<{
      project_name: string;
      todo: string;
      done: string;
      downloader_count: number;
    }>(
      'SELECT project_name, todo, done, downloader_count FROM project_stats ORDER BY project_name',
    );
    expect(stats.map((s) => s.project_name)).toEqual(['blogger', 'telegram']);
    expect(Number(stats[0]!.todo)).toBe(tracker.counts.get('blogger')!.todo);
    expect(stats[0]!.downloader_count).toBe(3);
    expect(tracker.requests.find((r) => r.url === '/projects.json')?.userAgent).toMatch(
      /^ramesses\//,
    );
  });

  it('retires projects that leave the catalog, keeps their rows, and un-retires on return', async () => {
    await sampler.runOnce(T0);
    const full = tracker.catalog;
    tracker.catalog = { ...full, projects: full.projects.filter((p) => p.name !== 'blogger') };
    await sampler.runOnce(minutes(15));
    let [blogger] = await query<{ active: boolean; first_seen_at: Date; last_seen_at: Date }>(
      "SELECT active, first_seen_at, last_seen_at FROM projects WHERE name = 'blogger'",
    );
    expect(blogger!.active).toBe(false);
    expect(blogger!.last_seen_at.toISOString()).toBe(T0.toISOString());
    expect(await query("SELECT 1 FROM project_stats WHERE project_name = 'blogger'")).toHaveLength(
      1,
    );

    tracker.catalog = full;
    await sampler.runOnce(minutes(30));
    [blogger] = await query(
      "SELECT active, first_seen_at, last_seen_at FROM projects WHERE name = 'blogger'",
    );
    expect(blogger!.active).toBe(true);
    expect(blogger!.first_seen_at.toISOString()).toBe(T0.toISOString());
    expect(blogger!.last_seen_at.toISOString()).toBe(minutes(30).toISOString());
  });

  it('clears a recorded error on the next success and prunes beyond retention', async () => {
    tracker.failing.add('blogger');
    await sampler.runOnce(T0);
    expect(
      (
        await query<{ last_error: string }>(
          "SELECT last_error FROM projects WHERE name = 'blogger'",
        )
      )[0]!.last_error,
    ).toMatch(/HTTP 500/);
    tracker.failing.clear();
    const later = new Date(T0.getTime() + 25 * 3_600_000); // beyond the 1-day retention used here
    const result = await sampler.runOnce(later);
    expect(result.pruned).toBe(1); // telegram's first sample aged out; blogger had none
    const [row] = await query<{ last_error: string | null; last_sampled_at: Date }>(
      "SELECT last_error, last_sampled_at FROM projects WHERE name = 'blogger'",
    );
    expect(row).toMatchObject({ last_error: null, last_sampled_at: later });
  });

  it('keeps stored projects when the catalog comes back empty', async () => {
    await sampler.runOnce(T0);
    tracker.catalog = { ...tracker.catalog, projects: [] };
    await sampler.runOnce(minutes(15));
    expect(await query('SELECT 1 FROM projects WHERE active')).toHaveLength(21);
  });
});

describe('ProjectsService reads', () => {
  it('derives rates and health from stored samples', async () => {
    // Five samples, 15 minutes apart: blogger completes 600 items per interval.
    for (let i = 0; i < 5; i++) {
      if (i > 0) tracker.advance('blogger', { done: 600, todo: i % 2 ? 8_000 : -8_000 }); // 340 → 8340 → 340 …
      await sampler.runOnce(minutes(15 * i));
    }
    const now = minutes(60).getTime();
    const summaries = await service.summaries(false, now);
    const blogger = summaries.find((p) => p.name === 'blogger')!;
    expect(blogger.latest?.done).toBe(tracker.counts.get('blogger')!.done);
    expect(blogger.doneRate.h1).toBeCloseTo(2400);
    expect(blogger.doneRate.h24).toBeCloseTo(2400);
    expect(blogger.todo24h).toMatchObject({ samples: 5, availability: 1 });
    expect(blogger.health).toBe('healthy');
    expect(blogger.trend).toHaveLength(4);
    expect(blogger.trend[0]!.perHour).toBeCloseTo(2400);
    expect(blogger.lastError).toBeNull();

    const telegram = summaries.find((p) => p.name === 'telegram')!;
    expect(telegram.isAuto).toBe(true);
    expect(telegram.doneRate.h1).toBe(0);
    expect(telegram.health).toBe('backlog');

    const urlteam = summaries.find((p) => p.name === 'urlteam2')!;
    expect(urlteam.tracker).toBe('terroroftinytown');
    expect(urlteam.latest).toBeNull();
    expect(urlteam.health).toBe('unknown');

    // hidden projects: none listed=false in the fixture, so retire one and check the filter
    tracker.catalog = {
      ...tracker.catalog,
      projects: tracker.catalog.projects.filter((p) => p.name !== 'imgur'),
    };
    await sampler.runOnce(minutes(75));
    expect((await service.summaries(false, now)).some((p) => p.name === 'imgur')).toBe(false);
    expect((await service.summaries(true, now)).some((p) => p.name === 'imgur')).toBe(true);
  });

  it('returns detail and history, raw for 24h and hourly beyond', async () => {
    for (let i = 0; i < 8; i++) {
      if (i > 0) tracker.advance('blogger', { done: 100 });
      await sampler.runOnce(minutes(15 * i)); // spans 1h45m, three distinct hours
    }
    const now = minutes(120).getTime();
    const detail = await service.detail('blogger', now);
    expect(detail.name).toBe('blogger');
    expect(detail.doneRate.h1).toBeCloseTo(400);

    const raw: ProjectHistory = await service.history('blogger', '24h', now);
    expect(raw.resolution).toBe('raw');
    expect(raw.points).toHaveLength(8);
    expect(raw.points[0]!.donePerHour).toBeNull();
    expect(raw.points[1]!.donePerHour).toBeCloseTo(400);

    const hourly = await service.history('blogger', '7d', now);
    expect(hourly.resolution).toBe('hourly');
    expect(hourly.points.map((p) => p.sampledAt)).toEqual([
      minutes(45).toISOString(),
      minutes(105).toISOString(),
    ]);
    expect(hourly.points[1]!.donePerHour).toBeCloseTo(400);

    await expect(service.detail('nope', now)).rejects.toThrow(/not found/);
    await expect(service.history('nope', '24h', now)).rejects.toThrow(/not found/);
    const empty: ProjectSummary[] = await service.summaries(false, now);
    expect(empty.length).toBeGreaterThan(0);
  });
});
