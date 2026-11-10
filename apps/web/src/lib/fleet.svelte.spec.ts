import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BANDWIDTH_HISTORY,
  FINISHED_ITEM_TTL_MS,
  type ServerMessage,
  type TimedEvent,
  type WarriorSnapshot,
} from '@ramesses/shared';
import { FleetStore } from './fleet.svelte';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  public close() {
    this.closed = true;
  }
  public open() {
    this.onopen?.();
  }
  public push(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function snapshot(id: string, name = id): WarriorSnapshot {
  return {
    id,
    name,
    host: 'h',
    port: 8001,
    enabled: true,
    connection: { state: 'connected', lastSeenAt: 1, connectedAt: 1, lastError: null, attempts: 0 },
    instanceId: null,
    status: 'RUNNING_PROJECT',
    runnerStatus: 'running',
    project: null,
    items: [],
    bandwidth: null,
    bandwidthHistory: [],
    counters: { completed: 0, failed: 0, canceled: 0 },
    broadcastMessage: null,
    catalog: {},
    rolling: null,
    updatedAt: 1,
  };
}

const totals = {
  warriors: 1,
  enabled: 1,
  connected: 1,
  receiving: 10,
  sending: 5,
  received: 100,
  sent: 50,
  itemsInFlight: 0,
  completed: 0,
  failed: 0,
  projects: [],
  rollingWindowMs: 300000,
  avgReceiving: 0,
  avgSending: 0,
};

describe('FleetStore', () => {
  let store: FleetStore;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    store = new FleetStore();
  });

  afterEach(() => {
    store.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('connects to /ws and applies hello, warrior, removed, and fleet messages', () => {
    store.start();
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toMatch(/\/ws$/);
    expect(store.socket).toBe('connecting');
    ws.open();
    expect(store.socket).toBe('open');

    ws.push({
      type: 'hello',
      warriors: [snapshot('b', 'Bravo'), snapshot('a', 'alpha')],
      fleet: totals,
      projects: [],
    });
    expect(store.ready).toBe(true);
    expect(store.list.map((w) => w.name)).toEqual(['alpha', 'Bravo']);
    expect(store.totals.receiving).toBe(10);

    ws.push({ type: 'warrior', warrior: snapshot('c', 'charlie') });
    expect(store.list).toHaveLength(3);

    ws.push({ type: 'warrior_removed', id: 'b' });
    expect(store.list.map((w) => w.id)).toEqual(['a', 'c']);

    ws.push({ type: 'fleet', fleet: { ...totals, receiving: 42 } });
    expect(store.totals.receiving).toBe(42);
  });

  it('applies event batches, connection, and rolling deltas in place', () => {
    store.start();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.push({ type: 'hello', warriors: [snapshot('a')], fleet: totals, projects: [] });

    const bandwidth = (at: number): TimedEvent => ({
      at,
      event: {
        event_name: 'bandwidth',
        message: { received: at, sent: 0, receiving: at * 2, sending: 1 },
      },
    });
    ws.push({
      type: 'warrior_events',
      id: 'a',
      events: [
        bandwidth(1000),
        {
          at: 1500,
          event: {
            event_name: 'pipeline.start_item',
            message: {
              pipeline_id: 1,
              item: {
                id: 'i1',
                name: 'item one',
                number: 7,
                status: 'running',
                tasks: [{ id: 1, name: 'Fetch', status: 'running' }],
                output: '',
                project: 'p',
                start_time: 1,
              },
            },
          },
        },
        {
          at: 1600,
          event: { event_name: 'item.output', message: { item_id: 'i1', data: 'hi\n' } },
        },
        bandwidth(2000),
      ],
    });
    const a = store.warriors['a']!;
    expect(a.bandwidth?.receiving).toBe(4000);
    expect(a.bandwidthHistory.map((s) => s.at)).toEqual([1000, 2000]);
    expect(a.items.map((i) => [i.number, i.logTail])).toEqual([[7, 'hi\n']]);
    expect(store.list[0]!.bandwidth?.at).toBe(2000); // derived list sees the in-place change

    ws.push({
      type: 'warrior_connection',
      id: 'a',
      connection: {
        state: 'reconnecting',
        lastSeenAt: 2,
        connectedAt: null,
        lastError: 'x',
        attempts: 1,
      },
    });
    expect(a.connection.state).toBe('reconnecting');
    expect(a.items).toHaveLength(1); // only the connection changed

    ws.push({
      type: 'warrior_rolling',
      id: 'a',
      rolling: {
        windowMs: 300000,
        samples: 2,
        avgReceiving: 3000,
        avgSending: 1,
        peakReceiving: 4000,
        peakSending: 1,
      },
    });
    expect(a.rolling?.avgReceiving).toBe(3000);

    // Deltas for an unknown warrior are ignored rather than creating a phantom card.
    ws.push({ type: 'warrior_events', id: 'ghost', events: [bandwidth(3000)] });
    ws.push({
      type: 'warrior_connection',
      id: 'ghost',
      connection: {
        state: 'connected',
        lastSeenAt: 1,
        connectedAt: 1,
        lastError: null,
        attempts: 0,
      },
    });
    ws.push({ type: 'warrior_rolling', id: 'ghost', rolling: null });
    expect(Object.keys(store.warriors)).toEqual(['a']);

    // History stays capped like it does on the backend.
    ws.push({
      type: 'warrior_events',
      id: 'a',
      events: Array.from({ length: BANDWIDTH_HISTORY + 10 }, (_, i) => bandwidth(10_000 + i)),
    });
    expect(a.bandwidthHistory).toHaveLength(BANDWIDTH_HISTORY);
  });

  it('prunes finished items on its own clock', () => {
    vi.setSystemTime(100_000);
    store.start();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    const running = {
      id: 'i1',
      number: 1,
      name: 'running',
      status: 'running' as const,
      tasks: [],
      logTail: '',
      startTime: 1,
      finishedAt: null,
    };
    const done = {
      ...running,
      id: 'i2',
      name: 'done',
      status: 'completed' as const,
      finishedAt: 100_000,
    };
    ws.push({
      type: 'hello',
      warriors: [{ ...snapshot('a'), items: [running, done] }],
      fleet: totals,
      projects: [],
    });
    const items = store.warriors['a']!.items;
    vi.advanceTimersByTime(1000);
    expect(store.warriors['a']!.items.map((i) => i.id)).toEqual(['i1', 'i2']);
    // A tick that removes nothing must not swap the array, or every card re-renders its list.
    expect(store.warriors['a']!.items).toBe(items);
    vi.advanceTimersByTime(FINISHED_ITEM_TTL_MS);
    expect(store.warriors['a']!.items.map((i) => i.id)).toEqual(['i1']);
    expect(store.warriors['a']!.items).not.toBe(items);
    expect(store.now).toBe(100_000 + 1000 + FINISHED_ITEM_TTL_MS);
  });

  it('ignores malformed frames', () => {
    store.start();
    const ws = FakeWebSocket.instances[0]!;
    ws.onmessage?.({ data: 'not json' });
    expect(store.ready).toBe(false);
  });

  it('reconnects with backoff after the socket closes', () => {
    store.start();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.onclose?.();
    expect(store.socket).toBe('reconnecting');
    vi.advanceTimersByTime(1000 * 1.5 + 1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stop closes the socket and cancels reconnects', () => {
    store.start();
    const first = FakeWebSocket.instances[0]!;
    store.stop();
    expect(first.closed).toBe(true);
    first.onclose?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('ticks the clock every second', () => {
    vi.setSystemTime(1_000_000);
    store.start();
    vi.advanceTimersByTime(1000);
    expect(store.now).toBe(1_001_000);
  });
});

describe('project catalog over the socket', () => {
  it('fills the projects store from hello and from projects messages', async () => {
    const { projects } = await import('./projects.svelte');
    const { catalog } = await import('../test/project-fixtures');
    projects.items = [];
    projects.loadedAt = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const store = new FleetStore();
    store.start();
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    ws.open();
    ws.push({ type: 'hello', warriors: [], fleet: totals, projects: [catalog[0]!] });
    expect(projects.items.map((p) => p.name)).toEqual(['blogger']);
    expect(projects.loadedAt).not.toBeNull();
    ws.push({ type: 'projects', projects: catalog });
    expect(projects.items).toHaveLength(catalog.length);
    store.stop();
    vi.unstubAllGlobals();
  });
});
