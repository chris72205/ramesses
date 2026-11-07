import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WarriorRecord } from '@ramesses/shared';
import { bootTestApp } from '../support/app';
import { truncateAll } from '../support/test-db';

let app: NestFastifyApplication;
let databaseUrl: string;

beforeAll(async () => {
  ({ app, databaseUrl } = await bootTestApp());
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await truncateAll(databaseUrl);
});

describe('GET /api/health', () => {
  it('reports liveness without dependencies', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('reports database readiness', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    const body = res.json<{ info: Record<string, { status: string }> }>();
    expect(body.info.database?.status).toBe('up');
  });
});

describe('/api/warriors', () => {
  it('starts empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/warriors' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('creates with defaults, lists, updates, and deletes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/warriors',
      payload: { host: '10.0.0.9' },
    });
    expect(created.statusCode).toBe(201);
    const record = created.json<WarriorRecord>();
    expect(record).toMatchObject({
      host: '10.0.0.9',
      port: 8001,
      name: '10.0.0.9:8001',
      enabled: true,
    });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);

    const listed = await app.inject({ method: 'GET', url: '/api/warriors' });
    expect(listed.json<WarriorRecord[]>().map((w) => w.id)).toEqual([record.id]);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${record.id}`,
      payload: { name: 'nine', enabled: false, port: 8010 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'nine', enabled: false, port: 8010 });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/warriors/${record.id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/warriors' })).json()).toEqual([]);
  });

  it('rejects invalid input with 400 and details', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/warriors',
      payload: { host: 'not a host!', port: 70000, extra: 1 },
    });
    expect(bad.statusCode).toBe(400);
    const message = bad.json<{ message: string[] }>().message.join(' ');
    expect(message).toMatch(/host must be a hostname/);
    expect(message).toMatch(/port must not be greater than 65535/);
    expect(message).toMatch(/property extra should not exist/);
  });

  it('rejects duplicate host and port with 409', async () => {
    await app.inject({ method: 'POST', url: '/api/warriors', payload: { host: 'dup', port: 1 } });
    const again = await app.inject({
      method: 'POST',
      url: '/api/warriors',
      payload: { host: 'dup', port: 1 },
    });
    expect(again.statusCode).toBe(409);
  });

  it('returns 404 for unknown ids and 400 for malformed ids', async () => {
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/warriors/00000000-0000-4000-8000-000000000000',
      payload: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    const malformed = await app.inject({ method: 'DELETE', url: '/api/warriors/nope' });
    expect(malformed.statusCode).toBe(400);
  });

  it('serves OpenAPI docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs-json' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ paths: Record<string, unknown> }>().paths).toHaveProperty('/api/warriors');
  });
});
