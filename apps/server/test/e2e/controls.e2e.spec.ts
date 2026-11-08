import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ControlAccepted, ServerMessage, WarriorRecord } from '@ramesses/shared';
import { bootTestApp } from '../support/app';
import { FakeWarrior } from '../support/fake-warrior';
import { PushClient } from '../support/push-client';

let app: NestFastifyApplication | undefined;
let baseUrl: string;
let warrior: FakeWarrior | undefined;

type Hello = Extract<ServerMessage, { type: 'hello' }>;
type Snapshot = Extract<ServerMessage, { type: 'warrior' }>;

beforeAll(async () => {
  ({ app } = await bootTestApp());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
  warrior = await new FakeWarrior({ tickMs: 100 }).start();
});

afterAll(async () => {
  await warrior?.stop();
  await app?.close();
});

describe('warrior controls end to end', () => {
  it('posts to the warrior, resyncs browsers, and shows the switch as the warrior reports it', async () => {
    const fake = warrior!;
    // The warrior reacts to a selection the way the real one does: it announces the choice, then
    // the status moves through starting to running once the pipeline is up.
    fake.options.onCommand = (command, fields) => {
      if (command !== 'select-project') return;
      const name = fields['project_name']!;
      setTimeout(() => {
        fake.emit({ event_name: 'warrior.project_selected', message: { project: { name } } });
        fake.emit({ event_name: 'warrior.status', message: { status: 'STARTING_PROJECT' } });
      }, 50);
      setTimeout(
        () => fake.emit({ event_name: 'warrior.status', message: { status: 'RUNNING_PROJECT' } }),
        150,
      );
    };

    const client = new PushClient(`${baseUrl.replace('http', 'ws')}/ws`);
    await client.open();
    await client.waitFor('hello', (m): m is Hello => m.type === 'hello');

    const res = await fetch(`${baseUrl}/api/warriors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: fake.port, name: 'fake' }),
    });
    const { id } = (await res.json()) as WarriorRecord;
    const before = await client.waitForState(
      'catalog loaded',
      id,
      (w) => w.connection.state === 'connected' && Object.keys(w.catalog).length > 0,
    );
    expect(before.project?.title).toBe('uploader.jp');
    expect(before.catalog).toHaveProperty('telegram');

    const accepted = await fetch(`${baseUrl}/api/warriors/${id}/project`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'telegram' }),
    });
    expect(accepted.status).toBe(202);
    expect(((await accepted.json()) as ControlAccepted).command).toBe('select_project');
    expect(fake.requests.at(-1)).toMatchObject({
      path: '/api/select-project',
      fields: { project_name: 'telegram' },
    });

    // The acknowledgment triggers a full snapshot for every browser.
    const resync = await client.waitFor(
      'resync after control',
      (m): m is Snapshot => m.type === 'warrior' && m.warrior.id === id,
    );
    expect(resync.warrior.connection.state).toBe('connected');

    // Then the warrior's own events carry the change through the shared reducer.
    const switched = await client.waitForState(
      'running the new project',
      id,
      (w) => w.project?.name === 'telegram' && w.status === 'RUNNING_PROJECT',
    );
    expect(switched.project?.title).toBe(before.catalog['telegram']!.title);
    expect(fake.settings['selected_project']).toBe('telegram');

    const idle = await fetch(`${baseUrl}/api/warriors/${id}/project`, { method: 'DELETE' });
    expect(idle.status).toBe(202);
    expect(fake.requests.at(-1)?.path).toBe('/api/deselect-project');
    await client.waitFor(
      'resync after deselect',
      (m): m is Snapshot => m.type === 'warrior' && m.warrior.id === id,
    );
    client.close();
  });
});
