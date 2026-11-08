import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LeaderElectionService,
  RELEASE_SCRIPT,
  RENEW_SCRIPT,
  type LeaderRedis,
} from './leader-election.service';

const config = {
  get: (key: string) =>
    ({ REDIS_KEY_PREFIX: 'test', LEADER_TTL_MS: 3000, LEADER_RENEW_MS: 1000 })[key],
} as unknown as ConfigService<Env, true>;

/** In-memory stand-in for the three Redis operations the election uses. */
class FakeRedis implements LeaderRedis {
  store = new Map<string, string>();
  failing = false;
  on?: LeaderRedis['on'];
  off?: LeaderRedis['off'];
  set = vi.fn(async (key: string, value: string) => {
    if (this.failing) throw new Error('connection refused');
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }) as unknown as LeaderRedis['set'];
  eval = vi.fn(async (script: string, _n: number, key: string, id: string) => {
    if (this.failing) throw new Error('connection refused');
    if (this.store.get(key) !== id) return 0;
    if (script === RELEASE_SCRIPT) this.store.delete(key);
    return 1;
  }) as unknown as LeaderRedis['eval'];
}

describe('LeaderElectionService', () => {
  let redis: FakeRedis;
  let a: LeaderElectionService;
  let b: LeaderElectionService;
  let events: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    redis = new FakeRedis();
    a = new LeaderElectionService(redis, config);
    b = new LeaderElectionService(redis, config);
    events = [];
    for (const [name, s] of [
      ['a', a],
      ['b', b],
    ] as const) {
      s.on('elected', () => events.push(`${name}:elected`));
      s.on('lost', () => events.push(`${name}:lost`));
    }
  });

  afterEach(async () => {
    await a.stop();
    await b.stop();
    vi.useRealTimers();
  });

  it('elects exactly one of two competitors and renews while leading', async () => {
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.isLeader).not.toBe(b.isLeader);
    expect(events).toHaveLength(1);
    expect(a.key).toBe('test:leader');
    await vi.advanceTimersByTimeAsync(1000);
    const renews = (redis.eval as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === RENEW_SCRIPT,
    );
    expect(renews).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('hands over when the lease expires and does not steal it back', async () => {
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.isLeader).toBe(true);
    // Simulate expiry: Redis forgets the key, then b's tick wins before a renews.
    redis.store.clear();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.isLeader).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.isLeader).toBe(false);
    expect(b.isLeader).toBe(true);
    expect(events).toEqual(['a:elected', 'b:elected', 'a:lost']);
  });

  it('steps down on a Redis error and recovers later', async () => {
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    redis.failing = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.isLeader).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); // error while not leading: only logged
    redis.failing = false;
    redis.store.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.isLeader).toBe(true);
    expect(events).toEqual(['a:elected', 'a:lost', 'a:elected']);
  });

  it('releases the key on stop so the next replica takes over immediately', async () => {
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    await a.stop();
    expect(a.isLeader).toBe(false);
    expect(redis.store.size).toBe(0);
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.isLeader).toBe(true);
    // stop while not leading is a no-op, and start is idempotent
    await b.stop();
    await b.stop();
    b.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.isLeader).toBe(true);
  });

  it('does not overlap ticks', async () => {
    let release!: (value: 'OK') => void;
    redis.set = vi.fn(() => new Promise<'OK'>((resolve) => (release = resolve))) as never;
    a.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(redis.set).toHaveBeenCalledTimes(1);
    release('OK');
    await vi.advanceTimersByTimeAsync(0);
    expect(a.isLeader).toBe(true);
  });

  it('competes as soon as the Redis connection becomes ready', async () => {
    let onReady: (() => void) | undefined;
    redis.failing = true;
    redis.on = vi.fn((_event: 'ready', listener: () => void) => (onReady = listener)) as never;
    const c = new LeaderElectionService(redis, config);
    c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.isLeader).toBe(false);
    redis.failing = false;
    onReady!();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.isLeader).toBe(true);
    await c.stop();
  });

  it('attaches one ready listener per run and removes it on stop', async () => {
    const listeners = new Set<() => void>();
    redis.on = vi.fn((_event: 'ready', listener: () => void) => listeners.add(listener)) as never;
    redis.off = vi.fn((_event: 'ready', listener: () => void) =>
      listeners.delete(listener),
    ) as never;
    const c = new LeaderElectionService(redis, config);
    c.start();
    c.start();
    expect(listeners.size).toBe(1);
    await c.stop();
    expect(listeners.size).toBe(0);
    c.start();
    expect(listeners.size).toBe(1);
    await c.stop();
    expect(listeners.size).toBe(0);
  });

  it('runs the lifecycle hooks', async () => {
    a.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.isLeader).toBe(true);
    await a.onModuleDestroy();
    expect(a.isLeader).toBe(false);
  });
});
