import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyEvent,
  type ServerMessage,
  type WarriorRecord,
  type WarriorSnapshot,
} from '@ramesses/shared';
import { bootTestApp } from '../support/app';
import { FakeWarrior } from '../support/fake-warrior';

let app: NestFastifyApplication | undefined;
let baseUrl: string;
let warrior: FakeWarrior | undefined;

type Hello = Extract<ServerMessage, { type: 'hello' }>;
type Fleet = Extract<ServerMessage, { type: 'fleet' }>;
type Removed = Extract<ServerMessage, { type: 'warrior_removed' }>;

/**
 * A browser stand-in: keeps warrior state the way the web store does (full snapshots on hello
 * and `warrior`, the shared reducer for `warrior_events`) and resolves waits in arrival order.
 */
class PushClient {
  readonly messages: ServerMessage[] = [];
  readonly warriors = new Map<string, WarriorSnapshot>();
  private cursor = 0;
  private readonly ws: WebSocket;
  private waiters: Array<{
    test: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      this.apply(message);
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.test(message)) return true;
        w.resolve(message);
        return false;
      });
    });
  }

  public open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  /** Resolve with the first message after the previous wait that satisfies `test`. */
  public waitFor<T extends ServerMessage>(
    label: string,
    test: (m: ServerMessage) => m is T,
    timeoutMs = 10_000,
  ): Promise<T> {
    for (let i = this.cursor; i < this.messages.length; i++) {
      const candidate = this.messages[i]!;
      if (test(candidate)) {
        this.cursor = i + 1;
        return Promise.resolve(candidate);
      }
    }
    this.cursor = this.messages.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for: ${label}`)),
        timeoutMs,
      );
      this.waiters.push({
        test,
        resolve: (m) => {
          clearTimeout(timer);
          this.cursor = this.messages.length;
          resolve(m as T);
        },
      });
    });
  }

  /** Wait until the locally reduced state for `id` satisfies `predicate`; returns that state. */
  public async waitForState(
    label: string,
    id: string,
    predicate: (w: WarriorSnapshot) => boolean,
    timeoutMs = 10_000,
  ): Promise<WarriorSnapshot> {
    const satisfied = () => {
      const w = this.warriors.get(id);
      return w !== undefined && predicate(w);
    };
    if (!satisfied()) {
      await this.waitFor(
        label,
        (m): m is ServerMessage => ('id' in m ? m.id === id : m.type === 'warrior') && satisfied(),
        timeoutMs,
      );
    }
    return this.warriors.get(id)!;
  }

  public close(): void {
    this.ws.close();
  }

  private apply(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        this.warriors.clear();
        for (const w of message.warriors) this.warriors.set(w.id, w);
        break;
      case 'warrior':
        this.warriors.set(message.warrior.id, message.warrior);
        break;
      case 'warrior_events': {
        const w = this.warriors.get(message.id);
        if (w) for (const { at, event } of message.events) applyEvent(w, event, at);
        break;
      }
      case 'warrior_connection': {
        const w = this.warriors.get(message.id);
        if (w) w.connection = message.connection;
        break;
      }
      case 'warrior_rolling': {
        const w = this.warriors.get(message.id);
        if (w) w.rolling = message.rolling;
        break;
      }
      case 'warrior_removed':
        this.warriors.delete(message.id);
        break;
      case 'fleet':
        break;
    }
  }
}

const hello = (m: ServerMessage): m is Hello => m.type === 'hello';

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

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('fleet end to end', () => {
  it('streams a newly added warrior to connected browsers and removes it on delete', async () => {
    const fake = warrior!;
    const client = new PushClient(`${baseUrl.replace('http', 'ws')}/ws`);
    await client.open();
    expect((await client.waitFor('hello', hello)).warriors).toEqual([]);

    const res = await api('POST', '/api/warriors', {
      host: '127.0.0.1',
      port: fake.port,
      name: 'fake',
    });
    expect(res.status).toBe(201);
    const record = (await res.json()) as WarriorRecord;
    const id = record.id;

    const connected = await client.waitForState(
      'connected',
      id,
      (w) => w.connection.state === 'connected',
    );
    expect(connected.name).toBe('fake');

    const withData = await client.waitForState(
      'data from burst',
      id,
      (w) => w.bandwidth !== null && w.items.length === 3 && w.status === 'RUNNING_PROJECT',
    );
    expect(withData.project?.title).toBe('uploader.jp');
    expect(withData.bandwidth?.receiving).toBe(1000);

    // Steady state is event batches, not snapshots: the client-side reducer keeps up with ticks.
    const batch = await client.waitFor(
      'bandwidth batch',
      (m): m is Extract<ServerMessage, { type: 'warrior_events' }> =>
        m.type === 'warrior_events' &&
        m.id === id &&
        m.events.some((e) => e.event.event_name === 'bandwidth'),
    );
    expect(batch.events.every((e) => e.event.event_name !== 'timestamp')).toBe(true);
    expect(client.warriors.get(id)!.bandwidthHistory.length).toBeGreaterThan(1);

    // An item event from the warrior reaches the client through the reducer.
    const itemId = withData.items[0]!.id;
    fake.emit({ event_name: 'item.complete', message: { pipeline_id: 1, item_id: itemId } });
    const completed = await client.waitForState('item completed', id, (w) =>
      w.items.some((i) => i.id === itemId && i.status === 'completed'),
    );
    expect(completed.counters.completed).toBe(1);

    const rolling = await client.waitForState(
      'rolling stats',
      id,
      (w) => (w.rolling?.samples ?? 0) > 0,
      15_000,
    );
    // The recorded burst carries one real sample (1246 B/s); every fake tick is 1000 B/s.
    expect(rolling.rolling?.avgReceiving).toBeGreaterThanOrEqual(1000);
    expect(rolling.rolling?.avgReceiving).toBeLessThanOrEqual(1247);

    const fleet = await client.waitFor(
      'fleet totals',
      (m): m is Fleet => m.type === 'fleet' && m.fleet.connected === 1,
    );
    expect(fleet.fleet.projects).toEqual(['uploader.jp']);
    expect(fleet.fleet.rollingWindowMs).toBe(300_000);

    // A second browser gets the current state in its hello, matching what the first one reduced.
    const late = new PushClient(`${baseUrl.replace('http', 'ws')}/ws`);
    await late.open();
    const lateHello = await late.waitFor('late hello', hello);
    expect(lateHello.warriors.map((w) => w.id)).toEqual([id]);
    const mine = client.warriors.get(id)!;
    expect(lateHello.warriors[0]!.project).toEqual(mine.project);
    expect(lateHello.warriors[0]!.items.map((i) => i.id)).toEqual(mine.items.map((i) => i.id));
    expect(lateHello.warriors[0]!.counters).toEqual(mine.counters);
    late.close();

    // The warrior restarting drops the session; the collector reconnects and resyncs with a snapshot.
    const before = fake.connections;
    fake.dropAll();
    await client.waitForState('reconnecting', id, (w) => w.connection.state === 'reconnecting');
    const resync = await client.waitFor(
      'reconnected',
      (m): m is Extract<ServerMessage, { type: 'warrior' }> =>
        m.type === 'warrior' && m.warrior.id === id && m.warrior.connection.state === 'connected',
      15_000,
    );
    expect(resync.warrior.bandwidthHistory.length).toBeGreaterThan(0);
    expect(fake.connections).toBeGreaterThan(before);

    // Disabling stops collection; the card stays with enabled=false.
    expect((await api('PATCH', `/api/warriors/${id}`, { enabled: false })).status).toBe(200);
    const disabled = await client.waitForState('disabled', id, (w) => !w.enabled);
    expect(disabled.connection.state).toBe('offline');

    expect((await api('DELETE', `/api/warriors/${id}`)).status).toBe(204);
    await client.waitFor(
      'removed',
      (m): m is Removed => m.type === 'warrior_removed' && m.id === id,
    );
    expect(client.warriors.has(id)).toBe(false);
    client.close();
  });
});
