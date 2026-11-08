import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ControlAccepted, WarriorRecord, WarriorSettings } from '@ramesses/shared';
import { bootTestApp } from '../support/app';
import { FakeWarrior } from '../support/fake-warrior';
import { truncateAll } from '../support/test-db';

let app: NestFastifyApplication;
let databaseUrl: string;
let fake: FakeWarrior;
let locked: FakeWarrior;
let rejecting: FakeWarrior;

beforeAll(async () => {
  fake = await new FakeWarrior({ tickMs: 100 }).start();
  locked = await new FakeWarrior({ tickMs: 100, auth: { username: 'me', password: 'pw' } }).start();
  rejecting = await new FakeWarrior({
    tickMs: 100,
    settingsErrors: { downloader: 'Invalid value for your nickname.' },
  }).start();
  ({ app, databaseUrl } = await bootTestApp());
});

afterAll(async () => {
  await app?.close();
  await Promise.all([fake?.stop(), locked?.stop(), rejecting?.stop()]);
});

beforeEach(async () => {
  await truncateAll(databaseUrl);
  fake.requests.length = 0;
  locked.requests.length = 0;
});

async function addWarrior(port: number, name: string): Promise<WarriorRecord> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/warriors',
    payload: { host: '127.0.0.1', port, name },
  });
  expect(res.statusCode).toBe(201);
  return res.json<WarriorRecord>();
}

/** The collector needs a moment to open the socket and receive the catalog from the burst. */
async function waitForCatalog(id: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: `/api/warriors/${id}/settings` });
    if (res.statusCode === 200) {
      // Settings answer as soon as HTTP works; the catalog arrives over the socket shortly after.
      const probe = await app.inject({
        method: 'PUT',
        url: `/api/warriors/${id}/project`,
        payload: { name: 'definitely-not-a-project' },
      });
      if (probe.statusCode === 400) return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('catalog never arrived');
}

describe('/api/warriors/:id controls', () => {
  it('selects a catalog project, deselects, and reports both as accepted', async () => {
    const record = await addWarrior(fake.port, 'fake');
    await waitForCatalog(record.id);

    const selected = await app.inject({
      method: 'PUT',
      url: `/api/warriors/${record.id}/project`,
      payload: { name: 'telegram' },
    });
    expect(selected.statusCode).toBe(202);
    expect(selected.json<ControlAccepted>()).toMatchObject({
      id: record.id,
      command: 'select_project',
    });
    expect(fake.requests.at(-1)).toEqual({
      method: 'POST',
      path: '/api/select-project',
      fields: { project_name: 'telegram' },
    });
    expect(fake.settings['selected_project']).toBe('telegram');

    const deselected = await app.inject({
      method: 'DELETE',
      url: `/api/warriors/${record.id}/project`,
    });
    expect(deselected.statusCode).toBe(202);
    expect(deselected.json<ControlAccepted>().command).toBe('deselect_project');
    expect(fake.requests.at(-1)).toMatchObject({ path: '/api/deselect-project', fields: {} });
    expect(fake.settings['selected_project']).toBe('none');
  });

  it('refuses auto and unknown names with 400 without touching the warrior', async () => {
    const record = await addWarrior(fake.port, 'fake');
    await waitForCatalog(record.id);
    fake.requests.length = 0;
    for (const name of ['auto', 'blogger']) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/warriors/${record.id}/project`,
        payload: { name },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toMatch(
        `does not list a project named "${name}"`,
      );
    }
    const empty = await app.inject({
      method: 'PUT',
      url: `/api/warriors/${record.id}/project`,
      payload: { name: '', extra: true },
    });
    expect(empty.statusCode).toBe(400);
    expect(fake.requests).toEqual([]);
  });

  it('answers 409 for a disabled warrior and for one whose catalog has not arrived', async () => {
    const record = await addWarrior(fake.port, 'fake');
    const dead = await addWarrior(1, 'dead');
    const noCatalog = await app.inject({
      method: 'PUT',
      url: `/api/warriors/${dead.id}/project`,
      payload: { name: 'telegram' },
    });
    expect(noCatalog.statusCode).toBe(409);
    expect(noCatalog.json<{ message: string }>().message).toMatch(/catalog/);

    await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${record.id}`,
      payload: { enabled: false },
    });
    const disabled = await app.inject({
      method: 'DELETE',
      url: `/api/warriors/${record.id}/project`,
    });
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json<{ message: string }>().message).toMatch(/disabled/);
  });

  it('answers 502 when the warrior cannot be reached or wants credentials', async () => {
    const dead = await addWarrior(1, 'dead');
    const unreachable = await app.inject({
      method: 'DELETE',
      url: `/api/warriors/${dead.id}/project`,
    });
    expect(unreachable.statusCode).toBe(502);
    expect(unreachable.json<{ message: string }>().message).toMatch(/Could not reach dead/);

    const protectedRecord = await addWarrior(locked.port, 'locked');
    const unauthorized = await app.inject({
      method: 'DELETE',
      url: `/api/warriors/${protectedRecord.id}/project`,
    });
    expect(unauthorized.statusCode).toBe(502);
    expect(unauthorized.json<{ message: string }>().message).toMatch(/username and password/);
    expect(locked.requests.at(-1)?.path).toBe('/api/deselect-project');
  });

  it('reads and writes settings, validating in Ramesses and on the warrior', async () => {
    const record = await addWarrior(fake.port, 'fake');
    const read = await app.inject({ method: 'GET', url: `/api/warriors/${record.id}/settings` });
    expect(read.statusCode).toBe(200);
    expect(read.json<WarriorSettings>()).toEqual({ downloader: 'fake', concurrentItems: 2 });

    const tooMany = await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${record.id}/settings`,
      payload: { concurrentItems: 7 },
    });
    expect(tooMany.statusCode).toBe(400);
    const badNick = await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${record.id}/settings`,
      payload: { downloader: 'no spaces' },
    });
    expect(badNick.statusCode).toBe(400);
    const nothing = await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${record.id}/settings`,
      payload: {},
    });
    expect(nothing.statusCode).toBe(400);

    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${record.id}/settings`,
      payload: { concurrentItems: 4, downloader: 'nick_1' },
    });
    expect(changed.statusCode).toBe(202);
    expect(changed.json<ControlAccepted>().command).toBe('update_settings');
    expect(fake.requests.at(-1)).toMatchObject({
      path: '/api/settings',
      fields: { concurrent_items: '4', downloader: 'nick_1' },
    });
    const after = await app.inject({ method: 'GET', url: `/api/warriors/${record.id}/settings` });
    expect(after.json<WarriorSettings>()).toEqual({ downloader: 'nick_1', concurrentItems: 4 });

    const picky = await addWarrior(rejecting.port, 'picky');
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/warriors/${picky.id}/settings`,
      payload: { downloader: 'fine-here' },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      message: ['downloader: Invalid value for your nickname.'],
      fields: { downloader: 'Invalid value for your nickname.' },
    });
  });

  it('documents the control routes in OpenAPI', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs-json' });
    const paths = res.json<{ paths: Record<string, unknown> }>().paths;
    expect(paths).toHaveProperty('/api/warriors/{id}/project');
    expect(paths).toHaveProperty('/api/warriors/{id}/settings');
  });
});
