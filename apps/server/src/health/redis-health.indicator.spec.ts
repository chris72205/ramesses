import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import type { HealthIndicatorService } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis-health.indicator';

function indicators() {
  const up = vi.fn((data?: unknown) => ({ up: data }));
  const down = vi.fn((data?: unknown) => ({ down: data }));
  return {
    service: { check: vi.fn(() => ({ up, down })) } as unknown as HealthIndicatorService,
    up,
    down,
  };
}

describe('RedisHealthIndicator', () => {
  it('is up on PONG', async () => {
    const { service, up } = indicators();
    const redis = { ping: vi.fn(async () => 'PONG') } as unknown as Redis;
    await new RedisHealthIndicator(service, redis).isHealthy('redis');
    expect(up).toHaveBeenCalled();
  });

  it('is down on an unexpected reply or an error', async () => {
    const { service, down } = indicators();
    const redis = { ping: vi.fn(async () => 'WAT') } as unknown as Redis;
    await new RedisHealthIndicator(service, redis).isHealthy('redis');
    expect(down).toHaveBeenCalledWith({ reply: 'WAT' });
    const broken = {
      ping: vi.fn(async () => {
        throw new Error('refused');
      }),
    } as unknown as Redis;
    await new RedisHealthIndicator(service, broken).isHealthy('redis');
    expect(down).toHaveBeenCalledWith({ message: 'refused' });
  });
});
