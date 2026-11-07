import type { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bandwidthKey } from '../../src/metrics/bandwidth-window';
import { MetricsService } from '../../src/metrics/metrics.service';
import { RedisMetricsSink } from '../../src/metrics/redis-metrics.sink';
import '../support/test-db'; // loads .env

const RETENTION_SEC = 600;
const WINDOW_SEC = 300;
const config = {
  get: (key: string) => (key === 'METRICS_RETENTION_SEC' ? RETENTION_SEC : WINDOW_SEC),
} as unknown as ConfigService;

let redis: Redis;
let sink: RedisMetricsSink;
let service: MetricsService;
const ref = { id: 'itest-warrior', name: 'w', host: 'h', port: 1 };

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { lazyConnect: true });
  await redis.connect();
  sink = new RedisMetricsSink(redis, config as never);
  service = new MetricsService(redis, config as never);
});

afterAll(async () => {
  await redis.del(bandwidthKey(ref.id));
  await redis.quit();
});

beforeEach(async () => {
  await redis.del(bandwidthKey(ref.id));
});

async function flush(): Promise<void> {
  // onBandwidth is fire-and-forget; a round trip guarantees the pipeline landed.
  await redis.ping();
}

describe('Redis rolling-window metrics', () => {
  it('stores samples and aggregates the trailing window', async () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 10; i++) {
      sink.onBandwidth(ref, {
        at: now - i * 1000,
        receiving: 100 * (i + 1),
        sending: 10,
        received: 0,
        sent: 0,
      });
    }
    await flush();
    const stats = await service.windowStats(ref.id, WINDOW_SEC * 1000, now);
    expect(stats.samples).toBe(10);
    expect(stats.avgReceiving).toBe(550);
    expect(stats.peakReceiving).toBe(1000);
    expect(stats.avgSending).toBe(10);
    expect(await redis.pttl(bandwidthKey(ref.id))).toBeGreaterThan(0);
  });

  it('excludes samples outside the window and trims beyond retention', async () => {
    const now = 1_800_000_000_000;
    sink.onBandwidth(ref, {
      at: now - RETENTION_SEC * 1000 - 5000,
      receiving: 999,
      sending: 0,
      received: 0,
      sent: 0,
    });
    sink.onBandwidth(ref, {
      at: now - WINDOW_SEC * 1000 - 1000,
      receiving: 500,
      sending: 0,
      received: 0,
      sent: 0,
    });
    sink.onBandwidth(ref, { at: now, receiving: 100, sending: 0, received: 0, sent: 0 });
    await flush();
    expect(await redis.zcard(bandwidthKey(ref.id))).toBe(2); // the oldest was trimmed on the last write
    const stats = await service.windowStats(ref.id, WINDOW_SEC * 1000, now);
    expect(stats.samples).toBe(1);
    expect(stats.avgReceiving).toBe(100);
  });

  it('answers for many warriors in one round trip and forgets on request', async () => {
    const now = 1_800_000_000_000;
    sink.onBandwidth(ref, { at: now, receiving: 7, sending: 3, received: 0, sent: 0 });
    await flush();
    const many = await service.windowStatsForMany([ref.id, 'nobody'], WINDOW_SEC * 1000, now);
    expect(many.get(ref.id)?.avgReceiving).toBe(7);
    expect(many.get('nobody')?.samples).toBe(0);
    await service.forget(ref.id);
    expect(await redis.exists(bandwidthKey(ref.id))).toBe(0);
  });
});
