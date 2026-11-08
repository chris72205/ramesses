import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SockJsClientEvents, SockJsClientLike } from './sockjs-client';
import { FINISHED_ITEM_TTL_MS } from '@ramesses/shared';
import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  HEALTHY_AFTER_MS,
  PRUNE_INTERVAL_MS,
  WATCHDOG_MS,
  WarriorConnection,
  type WarriorUpdate,
} from './warrior-connection';

class FakeClient extends EventEmitter<SockJsClientEvents> implements SockJsClientLike {
  connected = false;
  closed = false;
  public connect() {
    this.connected = true;
  }
  public close() {
    this.closed = true;
  }
  public open() {
    this.emit('frame');
    this.emit('open');
  }
  public tick() {
    this.emit('frame');
    this.emit('event', { event_name: 'timestamp', message: { timestamp: 1 } });
  }
}

const record = { id: 'w1', name: 'w1', host: 'h', port: 8001, enabled: true };

describe('WarriorConnection', () => {
  let clients: FakeClient[];
  let connection: WarriorConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    clients = [];
    connection = new WarriorConnection({
      record,
      createClient: () => {
        const client = new FakeClient();
        clients.push(client);
        return client;
      },
      random: () => 0.5, // jitter factor of exactly 1
    });
  });

  afterEach(() => {
    connection.stop();
    vi.useRealTimers();
  });

  it('marks connected on open and resets live state', () => {
    connection.start();
    expect(connection.snapshot.connection.state).toBe('connecting');
    clients[0]!.open();
    expect(connection.snapshot.connection.state).toBe('connected');
    expect(connection.snapshot.connection.attempts).toBe(0);
  });

  it('reconnects with exponential backoff capped at the maximum', () => {
    connection.start();
    expect(clients).toHaveLength(1);
    for (let attempt = 1; attempt <= 9; attempt++) {
      clients[attempt - 1]!.emit('close', 'refused');
      expect(connection.snapshot.connection.state).toBe('reconnecting');
      expect(connection.snapshot.connection.attempts).toBe(attempt);
      const expected = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** (attempt - 1));
      vi.advanceTimersByTime(expected - 1);
      expect(clients).toHaveLength(attempt);
      vi.advanceTimersByTime(1);
      expect(clients).toHaveLength(attempt + 1);
    }
    expect(connection.snapshot.connection.lastError).toBe('refused');
  });

  it('resets the backoff after a healthy connection', () => {
    connection.start();
    clients[0]!.emit('close', 'x');
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    clients[1]!.emit('close', 'x');
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS * 2);
    clients[2]!.open();
    for (let t = 0; t < HEALTHY_AFTER_MS; t += 1000) {
      vi.advanceTimersByTime(1000);
      clients[2]!.tick();
    }
    clients[2]!.emit('close', 'x');
    expect(connection.snapshot.connection.attempts).toBe(1);
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    expect(clients).toHaveLength(4);
  });

  it('closes and reconnects when the warrior goes silent', () => {
    connection.start();
    clients[0]!.open();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(WATCHDOG_MS - 1);
      clients[0]!.tick();
    }
    expect(clients[0]!.closed).toBe(false);
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(clients[0]!.closed).toBe(true);
    expect(connection.snapshot.connection.state).toBe('reconnecting');
    expect(connection.snapshot.connection.lastError).toMatch(/no messages/);
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    expect(clients).toHaveLength(2);
  });

  it('treats a hung connect as a failure', () => {
    connection.start();
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(clients[0]!.closed).toBe(true);
    expect(connection.snapshot.connection.state).toBe('reconnecting');
  });

  it('stop closes the client, cancels retries, and reports offline', () => {
    connection.start();
    clients[0]!.emit('close', 'x');
    connection.stop();
    expect(connection.snapshot.connection.state).toBe('offline');
    vi.advanceTimersByTime(BACKOFF_MAX_MS * 2);
    expect(clients).toHaveLength(1);
  });

  it('emits typed updates and forwards metrics', () => {
    const metrics = { onBandwidth: vi.fn(), onItemFinished: vi.fn() };
    connection = new WarriorConnection({
      record,
      createClient: () => {
        const client = new FakeClient();
        clients.push(client);
        return client;
      },
      metrics,
    });
    const updates: WarriorUpdate[] = [];
    connection.on('update', (update) => updates.push(update));
    connection.start();
    expect(updates).toEqual([{ kind: 'connection' }]); // connecting
    clients[0]!.open();
    expect(updates.at(-1)).toEqual({ kind: 'snapshot' }); // live state was reset
    clients[0]!.emit('event', {
      event_name: 'bandwidth',
      message: { received: 1, sent: 2, receiving: 3, sending: 4 },
    });
    expect(metrics.onBandwidth).toHaveBeenCalledWith(
      { id: 'w1', name: 'w1', host: 'h', port: 8001 },
      expect.objectContaining({ received: 1, sending: 4 }),
    );
    expect(updates.at(-1)).toEqual({
      kind: 'event',
      event: {
        at: expect.any(Number) as number,
        event: {
          event_name: 'bandwidth',
          message: { received: 1, sent: 2, receiving: 3, sending: 4 },
        },
      },
    });

    // Events the reducer ignores are not forwarded.
    const count = updates.length;
    clients[0]!.tick();
    clients[0]!.emit('event', {
      event_name: 'item.output',
      message: { item_id: 'nope', data: 'x' },
    });
    expect(updates).toHaveLength(count);

    // project.refresh carries every item's full output, so it resyncs with a snapshot instead.
    clients[0]!.emit('event', {
      event_name: 'project.refresh',
      message: {
        project: { project_id: 'p', title: 'P', project_html: '', utc_deadline: null },
        status: 'running',
        items: [
          {
            id: 'i1',
            name: 'one',
            number: 1,
            status: 'running',
            tasks: [],
            output: '',
            project: 'p',
            start_time: 0,
          },
        ],
      },
    });
    expect(updates.at(-1)).toEqual({ kind: 'snapshot' });

    // A finished item ages out: clients prune themselves, so only a `pruned` hint is emitted.
    clients[0]!.emit('event', {
      event_name: 'item.complete',
      message: { pipeline_id: 1, item_id: 'i1' },
    });
    expect(updates.at(-1)).toMatchObject({
      kind: 'event',
      event: { event: { event_name: 'item.complete' } },
    });
    const beforePrune = updates.length;
    for (let t = 0; t < FINISHED_ITEM_TTL_MS + PRUNE_INTERVAL_MS; t += 1000) {
      vi.advanceTimersByTime(1000);
      clients[0]!.tick(); // keep the watchdog quiet; `timestamp` is never forwarded
    }
    expect(connection.snapshot.items).toEqual([]);
    expect(updates.slice(beforePrune)).toEqual([{ kind: 'pruned' }]);

    // Dropping the socket changes only the connection.
    clients[0]!.emit('close', 'gone');
    expect(updates.at(-1)).toEqual({ kind: 'connection' });
    expect(connection.snapshot.connection.state).toBe('reconnecting');
  });
});

describe('WarriorConnection extras', () => {
  it('rename emits a snapshot update only when the name differs, and start/stop are idempotent', () => {
    const connection = new WarriorConnection({ record, createClient: () => new FakeClient() });
    const update = vi.fn();
    connection.on('update', update);
    connection.rename('w1');
    expect(update).not.toHaveBeenCalled();
    connection.rename('renamed');
    expect(connection.snapshot.name).toBe('renamed');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ kind: 'snapshot' });
    connection.stop();
    expect(update).toHaveBeenCalledTimes(1);
    connection.start();
    connection.start();
    expect(connection.isRunning).toBe(true);
    connection.stop();
    expect(connection.isRunning).toBe(false);
  });

  it('starts offline when the record is disabled', () => {
    const connection = new WarriorConnection({
      record: { ...record, enabled: false },
      createClient: () => new FakeClient(),
    });
    expect(connection.snapshot.connection.state).toBe('offline');
  });
});
