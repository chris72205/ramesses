import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LeaderElectionService } from '../../src/leader/leader-election.service';
import '../support/test-db'; // loads .env

const PREFIX = `ramesses-itest-${process.pid}`;
const TTL_MS = 600;
const RENEW_MS = 150;
const config = {
  get: (key: string) =>
    ({ REDIS_KEY_PREFIX: PREFIX, LEADER_TTL_MS: TTL_MS, LEADER_RENEW_MS: RENEW_MS })[key],
} as unknown as ConfigService<Env, true>;

let redis: Redis;
const services: LeaderElectionService[] = [];

function replica(): LeaderElectionService {
  const service = new LeaderElectionService(redis, config);
  services.push(service);
  return service;
}

const until = async (test: () => boolean, timeoutMs = 3000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { lazyConnect: true });
  await redis.connect();
  await redis.del(`${PREFIX}:leader`);
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.stop()));
  await redis.del(`${PREFIX}:leader`);
});

afterAll(async () => {
  await redis.quit();
});

describe('leader election on a real Redis', () => {
  it('elects one of three replicas and keeps the lease alive past the TTL', async () => {
    const replicas = [replica(), replica(), replica()];
    for (const r of replicas) r.start();
    await until(() => replicas.some((r) => r.isLeader));
    await new Promise((resolve) => setTimeout(resolve, TTL_MS * 2));
    expect(replicas.filter((r) => r.isLeader)).toHaveLength(1);
    const leader = replicas.find((r) => r.isLeader)!;
    expect(await redis.get(`${PREFIX}:leader`)).toBe(leader.instanceId);
    expect(await redis.pttl(`${PREFIX}:leader`)).toBeGreaterThan(0);
  });

  it('hands over within one TTL when the leader stops renewing without releasing', async () => {
    const a = replica();
    const b = replica();
    a.start();
    await until(() => a.isLeader);
    b.start();
    await new Promise((resolve) => setTimeout(resolve, RENEW_MS * 2));
    expect(b.isLeader).toBe(false);
    // A crash: the timer dies but the key stays until it expires.
    clearInterval((a as unknown as { timer: NodeJS.Timeout }).timer);
    (a as unknown as { timer: null }).timer = null;
    const started = Date.now();
    await until(() => b.isLeader, TTL_MS * 3);
    expect(Date.now() - started).toBeLessThan(TTL_MS + RENEW_MS * 2);
    expect(await redis.get(`${PREFIX}:leader`)).toBe(b.instanceId);
  });

  it('hands over immediately on a clean stop', async () => {
    const a = replica();
    const b = replica();
    a.start();
    await until(() => a.isLeader);
    b.start();
    await a.stop();
    const started = Date.now();
    await until(() => b.isLeader);
    expect(Date.now() - started).toBeLessThan(TTL_MS);
  });
});
