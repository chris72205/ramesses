import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { RedisMetricsSink } from './redis-metrics.sink';

function fakeRedis(exec: () => Promise<unknown>) {
  const chain = { zadd: vi.fn(), zremrangebyscore: vi.fn(), pexpire: vi.fn(), exec: vi.fn(exec) };
  chain.zadd.mockReturnValue(chain);
  chain.zremrangebyscore.mockReturnValue(chain);
  chain.pexpire.mockReturnValue(chain);
  return { redis: { multi: vi.fn(() => chain) } as unknown as Redis, chain };
}

const config = { get: () => 600 } as never;
const ref = { id: 'w', name: 'w', host: 'h', port: 1 };
const sample = { at: 10_000_000, receiving: 1, sending: 2, received: 3, sent: 4 };

describe('RedisMetricsSink', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes, trims, and expires in one transaction', () => {
    const { redis, chain } = fakeRedis(async () => []);
    new RedisMetricsSink(redis, config).onBandwidth(ref, sample);
    expect(chain.zadd).toHaveBeenCalledWith('ramesses:bandwidth:w', sample.at, '10000000|1|2|3|4');
    expect(chain.zremrangebyscore).toHaveBeenCalledWith(
      'ramesses:bandwidth:w',
      '-inf',
      sample.at - 600_000,
    );
    expect(chain.pexpire).toHaveBeenCalledWith('ramesses:bandwidth:w', 600_000);
  });

  it('rate-limits warnings when Redis rejects writes', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { redis } = fakeRedis(async () => {
      throw new Error('down');
    });
    const sink = new RedisMetricsSink(redis, config);
    sink.onBandwidth(ref, sample);
    sink.onBandwidth(ref, sample);
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31_000);
    sink.onBandwidth(ref, sample);
    await vi.runAllTimersAsync();
    expect(warn).toHaveBeenCalledTimes(2);
    sink.onItemFinished();
  });
});
