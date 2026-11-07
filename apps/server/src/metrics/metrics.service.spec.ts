import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { MetricsService } from './metrics.service';

const config = { get: () => 300 } as never;

describe('MetricsService', () => {
  it('reads and decodes samples for one warrior', async () => {
    const redis = {
      zrangebyscore: vi.fn(async () => ['1|10|1|0|0', 'bad', '2|30|3|0|0']),
    } as unknown as Redis;
    const service = new MetricsService(redis, config);
    expect(service.windowMs).toBe(300_000);
    const stats = await service.windowStats('w', 60_000, 100_000);
    expect(redis.zrangebyscore).toHaveBeenCalledWith('ramesses:bandwidth:w', 40_000, '+inf');
    expect(stats).toMatchObject({ samples: 2, avgReceiving: 20, peakSending: 3 });
  });

  it('returns null per warrior when the pipeline fails and skips errored replies', async () => {
    const pipeline = { zrangebyscore: vi.fn(), exec: vi.fn() };
    pipeline.zrangebyscore.mockReturnValue(pipeline);
    const redis = {
      pipeline: vi.fn(() => pipeline),
      del: vi.fn(async () => 1),
    } as unknown as Redis;
    const service = new MetricsService(redis, config);

    pipeline.exec.mockRejectedValueOnce(new Error('down'));
    const failed = await service.windowStatsForMany(['a', 'b']);
    expect([...failed.values()]).toEqual([null, null]);

    pipeline.exec.mockResolvedValueOnce([
      [null, ['5|7|1|0|0']],
      [new Error('x'), null],
    ]);
    const mixed = await service.windowStatsForMany(['a', 'b', 'c'], 1000, 2000);
    expect(mixed.get('a')?.avgReceiving).toBe(7);
    expect(mixed.get('b')).toBeNull();
    expect(mixed.get('c')).toBeNull();
    expect(await service.windowStatsForMany([])).toEqual(new Map());
  });

  it('forget never throws', async () => {
    const redis = {
      del: vi.fn(async () => {
        throw new Error('down');
      }),
    } as unknown as Redis;
    await expect(new MetricsService(redis, config).forget('w')).resolves.toBeUndefined();
  });
});
