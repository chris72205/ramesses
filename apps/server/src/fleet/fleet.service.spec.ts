import { EventEmitter } from 'node:events';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshot, type ServerMessage, type TimedEvent } from '@ramesses/shared';
import type { Warrior } from '../warriors/warrior.entity';
import type { WarriorChange, WarriorsService } from '../warriors/warriors.service';
import { FLEET_PUSH_MS, FleetService, PUSH_COALESCE_MS } from './fleet.service';
import type { MetricsService } from '../metrics/metrics.service';
import { NoopMetricsSink } from './metrics-sink';
import type { WarriorConnection, WarriorConnectionOptions } from './warrior-connection';

class FakeConnection extends EventEmitter {
  readonly snapshot;
  started = 0;
  stopped = 0;
  constructor(readonly options: WarriorConnectionOptions) {
    super();
    this.snapshot = createSnapshot(options.record, 0);
  }
  public get id() {
    return this.snapshot.id;
  }
  public start() {
    this.started += 1;
    this.snapshot.connection.state = 'connected';
  }
  public stop() {
    this.stopped += 1;
    this.snapshot.connection.state = 'offline';
  }
  public rename(name: string) {
    this.snapshot.name = name;
    this.emit('update', { kind: 'snapshot' });
  }
}

const tick = (at: number): TimedEvent => ({
  at,
  event: { event_name: 'bandwidth', message: { received: at, sent: 0, receiving: 1, sending: 0 } },
});

function warrior(overrides: Partial<Warrior> = {}): Warrior {
  return { id: 'w1', name: 'one', host: 'h', port: 8001, enabled: true, ...overrides } as Warrior;
}

describe('FleetService', () => {
  const changes = new Subject<WarriorChange>();
  let connections: FakeConnection[];
  let service: FleetService;
  let messages: ServerMessage[];
  let findAll: ReturnType<typeof vi.fn>;
  let metricsService: {
    windowMs: number;
    forget: ReturnType<typeof vi.fn>;
    windowStatsForMany: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    connections = [];
    messages = [];
    findAll = vi.fn(async () => [warrior(), warrior({ id: 'w2', name: 'two', enabled: false })]);
    const warriors = { findAll, changes$: changes.asObservable() } as unknown as WarriorsService;
    metricsService = {
      windowMs: 300_000,
      forget: vi.fn(async () => undefined),
      windowStatsForMany: vi.fn(
        async (ids: string[]) =>
          new Map(
            ids.map((id) => [
              id,
              {
                windowMs: 300_000,
                samples: 3,
                avgReceiving: 10,
                avgSending: 1,
                peakReceiving: 20,
                peakSending: 2,
              },
            ]),
          ),
      ),
    };
    service = new FleetService(
      warriors,
      metricsService as unknown as MetricsService,
      new NoopMetricsSink(),
      (options) => {
        const c = new FakeConnection(options);
        connections.push(c);
        return c as unknown as WarriorConnection;
      },
    );
    service.subscribe((m) => messages.push(m));
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('starts enabled warriors from the database on init', async () => {
    await service.onModuleInit();
    expect(connections.map((c) => [c.id, c.started])).toEqual([
      ['w1', 1],
      ['w2', 0],
    ]);
    expect(service.snapshots().map((s) => s.id)).toEqual(['w1', 'w2']);
  });

  it('sends one snapshot per warrior on init and then pushes fleet totals', async () => {
    await service.onModuleInit();
    expect(messages).toEqual([]);
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    expect(messages.map((m) => m.type)).toEqual(['warrior', 'warrior']);
    vi.advanceTimersByTime(FLEET_PUSH_MS);
    const fleet = messages.find((m) => m.type === 'fleet');
    expect(fleet && fleet.type === 'fleet' && fleet.fleet).toMatchObject({
      warriors: 2,
      enabled: 1,
      connected: 1,
    });
  });

  it('batches events received within the coalescing window, in order', async () => {
    await service.onModuleInit();
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    messages.length = 0;
    connections[0]!.emit('update', { kind: 'event', event: tick(1) });
    connections[0]!.emit('update', { kind: 'event', event: tick(2) });
    vi.advanceTimersByTime(PUSH_COALESCE_MS - 1);
    connections[0]!.emit('update', { kind: 'event', event: tick(3) });
    expect(messages).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(messages).toEqual([
      { type: 'warrior_events', id: 'w1', events: [tick(1), tick(2), tick(3)] },
    ]);
    // The next window starts fresh.
    connections[0]!.emit('update', { kind: 'event', event: tick(4) });
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    expect(messages.at(-1)).toEqual({ type: 'warrior_events', id: 'w1', events: [tick(4)] });
  });

  it('sends a connection change on its own, and a snapshot instead of anything queued with it', async () => {
    await service.onModuleInit();
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    messages.length = 0;
    connections[0]!.snapshot.connection.state = 'reconnecting';
    connections[0]!.emit('update', { kind: 'connection' });
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    expect(messages).toEqual([
      {
        type: 'warrior_connection',
        id: 'w1',
        connection: expect.objectContaining({ state: 'reconnecting' }) as unknown,
      },
    ]);
    messages.length = 0;
    connections[0]!.emit('update', { kind: 'event', event: tick(1) });
    connections[0]!.emit('update', { kind: 'connection' });
    connections[0]!.emit('update', { kind: 'snapshot' });
    connections[0]!.emit('update', { kind: 'event', event: tick(2) });
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    expect(messages).toEqual([{ type: 'warrior', warrior: connections[0]!.snapshot }]);
  });

  it('only refreshes totals when finished items are pruned', async () => {
    await service.onModuleInit();
    vi.advanceTimersByTime(PUSH_COALESCE_MS + FLEET_PUSH_MS);
    messages.length = 0;
    connections[0]!.emit('update', { kind: 'pruned' });
    vi.advanceTimersByTime(PUSH_COALESCE_MS);
    expect(messages).toEqual([]);
    vi.advanceTimersByTime(FLEET_PUSH_MS);
    expect(messages.map((m) => m.type)).toEqual(['fleet']);
  });

  it('reacts to created, renamed, reconfigured, and removed warriors', async () => {
    await service.onModuleInit();
    changes.next({ type: 'created', warrior: warrior({ id: 'w3', name: 'three' }) });
    expect(connections.at(-1)?.id).toBe('w3');
    expect(connections.at(-1)?.started).toBe(1);

    changes.next({ type: 'updated', warrior: warrior({ id: 'w3', name: 'renamed' }) });
    expect(connections.filter((c) => c.id === 'w3')).toHaveLength(1);
    expect(service.snapshots().find((s) => s.id === 'w3')?.name).toBe('renamed');

    changes.next({ type: 'updated', warrior: warrior({ id: 'w3', name: 'renamed', port: 9000 }) });
    const w3 = connections.filter((c) => c.id === 'w3');
    expect(w3).toHaveLength(2);
    expect(w3[0]!.stopped).toBe(1);
    expect(w3[1]!.snapshot.port).toBe(9000);

    changes.next({
      type: 'updated',
      warrior: warrior({ id: 'w3', name: 'renamed', port: 9000, enabled: false }),
    });
    expect(connections.filter((c) => c.id === 'w3').at(-1)?.started).toBe(0);

    changes.next({ type: 'removed', id: 'w3' });
    expect(service.snapshots().map((s) => s.id)).toEqual(['w1', 'w2']);
    expect(messages).toContainEqual({ type: 'warrior_removed', id: 'w3' });
  });

  it('computes totals from connected warriors only', async () => {
    await service.onModuleInit();
    const s = connections[0]!.snapshot;
    s.bandwidth = { at: 0, received: 100, sent: 10, receiving: 5, sending: 1 };
    s.items = [
      {
        id: 'i',
        number: 1,
        name: 'x',
        status: 'running',
        tasks: [],
        logTail: '',
        startTime: 0,
        finishedAt: null,
      },
    ];
    s.project = { title: 'P', name: 'p', logo: null, leaderboard: null, deadline: null };
    s.counters.completed = 2;
    const disabled = connections[1]!.snapshot;
    disabled.bandwidth = { at: 0, received: 999, sent: 999, receiving: 999, sending: 999 };
    expect(service.totals()).toEqual({
      warriors: 2,
      enabled: 1,
      connected: 1,
      receiving: 5,
      sending: 1,
      received: 100,
      sent: 10,
      itemsInFlight: 1,
      completed: 2,
      failed: 0,
      projects: ['P'],
      rollingWindowMs: 300_000,
      avgReceiving: 0,
      avgSending: 0,
    });
  });

  it('stops everything on destroy', async () => {
    await service.onModuleInit();
    service.onModuleDestroy();
    expect(connections[0]!.stopped).toBe(1);
    expect(service.snapshots()).toEqual([]);
  });
});

describe('FleetService rolling stats', () => {
  it('refreshes rolling stats for running warriors only and folds them into totals', async () => {
    vi.useFakeTimers();
    const connections: FakeConnection[] = [];
    const metricsService = {
      windowMs: 300_000,
      forget: vi.fn(async () => undefined),
      windowStatsForMany: vi.fn(
        async (ids: string[]) =>
          new Map(
            ids.map((id) => [
              id,
              {
                windowMs: 300_000,
                samples: 3,
                avgReceiving: 10,
                avgSending: 1,
                peakReceiving: 20,
                peakSending: 2,
              },
            ]),
          ),
      ),
    };
    const warriors = {
      findAll: vi.fn(async () => [warrior(), warrior({ id: 'w2', name: 'two', enabled: false })]),
      changes$: new Subject<WarriorChange>().asObservable(),
    } as unknown as WarriorsService;
    const service = new FleetService(
      warriors,
      metricsService as unknown as MetricsService,
      new NoopMetricsSink(),
      (options) => {
        const c = new FakeConnection(options);
        connections.push(c);
        return c as unknown as WarriorConnection;
      },
    );
    await service.onModuleInit();
    // FakeConnection.start marks state connected but does not expose isRunning; emulate it.
    Object.defineProperty(connections[0], 'isRunning', { value: true });
    Object.defineProperty(connections[1], 'isRunning', { value: false });

    const messages: ServerMessage[] = [];
    service.subscribe((m) => messages.push(m));
    await service.refreshRolling();
    expect(metricsService.windowStatsForMany).toHaveBeenCalledWith(['w1']);
    expect(connections[0]!.snapshot.rolling?.avgReceiving).toBe(10);
    expect(messages).toEqual([
      {
        type: 'warrior_rolling',
        id: 'w1',
        rolling: expect.objectContaining({ avgReceiving: 10 }) as unknown,
      },
    ]);
    vi.advanceTimersByTime(FLEET_PUSH_MS);
    expect(messages.at(-1)?.type).toBe('fleet');
    expect(connections[1]!.snapshot.rolling).toBeNull();
    expect(service.totals()).toMatchObject({
      avgReceiving: 10,
      avgSending: 1,
      rollingWindowMs: 300_000,
    });

    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it("forgets a removed warrior's samples", async () => {
    const changes = new Subject<WarriorChange>();
    const metricsService = {
      windowMs: 1,
      forget: vi.fn(async () => undefined),
      windowStatsForMany: vi.fn(async () => new Map()),
    };
    const warriors = {
      findAll: vi.fn(async () => [warrior()]),
      changes$: changes.asObservable(),
    } as unknown as WarriorsService;
    const service = new FleetService(
      warriors,
      metricsService as unknown as MetricsService,
      new NoopMetricsSink(),
      (options) => new FakeConnection(options) as unknown as WarriorConnection,
    );
    await service.onModuleInit();
    changes.next({ type: 'removed', id: 'w1' });
    expect(metricsService.forget).toHaveBeenCalledWith('w1');
    service.onModuleDestroy();
  });
});
