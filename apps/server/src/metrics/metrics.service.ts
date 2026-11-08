import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { BandwidthSample, RollingStats } from '@ramesses/shared';
import type { Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { bandwidthKey, computeWindowStats, decodeSample } from './bandwidth-window';

/** Reads trailing-window aggregates back out of the samples the sink stores in Redis. */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly windowMs: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.windowMs = config.get('METRICS_WINDOW_SEC', { infer: true }) * 1000;
  }

  /** Raw samples for one warrior inside the window ending at `now`. */
  public async samples(
    warriorId: string,
    windowMs = this.windowMs,
    now = Date.now(),
  ): Promise<BandwidthSample[]> {
    const members = await this.redis.zrangebyscore(bandwidthKey(warriorId), now - windowMs, '+inf');
    return members.map(decodeSample).filter((s): s is BandwidthSample => s !== null);
  }

  public async windowStats(
    warriorId: string,
    windowMs = this.windowMs,
    now = Date.now(),
  ): Promise<RollingStats> {
    return computeWindowStats(await this.samples(warriorId, windowMs, now), windowMs);
  }

  /** Drop a warrior's samples, e.g. when it is deleted. Never throws. */
  public async forget(warriorId: string): Promise<void> {
    await this.redis.del(bandwidthKey(warriorId)).catch((error: Error) => {
      this.logger.debug(`forget failed: ${error.message}`);
    });
  }

  /**
   * Window stats for many warriors in one round trip. Returns null for every id when Redis
   * is unavailable so callers can show "no data" rather than stale numbers.
   */
  public async windowStatsForMany(
    warriorIds: string[],
    windowMs = this.windowMs,
    now = Date.now(),
  ): Promise<Map<string, RollingStats | null>> {
    const result = new Map<string, RollingStats | null>();
    if (warriorIds.length === 0) return result;
    try {
      const pipeline = this.redis.pipeline();
      for (const id of warriorIds) pipeline.zrangebyscore(bandwidthKey(id), now - windowMs, '+inf');
      const replies = (await pipeline.exec()) ?? [];
      warriorIds.forEach((id, i) => {
        const [error, members] = replies[i] ?? [new Error('missing reply'), null];
        if (error || !Array.isArray(members)) {
          result.set(id, null);
          return;
        }
        const samples = (members as string[])
          .map(decodeSample)
          .filter((s): s is BandwidthSample => s !== null);
        result.set(id, computeWindowStats(samples, windowMs));
      });
    } catch (error) {
      this.logger.debug(
        `window stats unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      for (const id of warriorIds) result.set(id, null);
    }
    return result;
  }
}
