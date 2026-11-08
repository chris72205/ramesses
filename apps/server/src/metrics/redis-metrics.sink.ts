import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { BandwidthSample } from '@ramesses/shared';
import type { Env } from '../config/env';
import type { MetricsSink, WarriorRef } from '../fleet/metrics-sink';
import { REDIS } from '../redis/redis.module';
import { bandwidthKey, encodeSample } from './bandwidth-window';

/**
 * Stores every bandwidth sample in a per-warrior sorted set, trimmed to the retention
 * period. Writes are fire-and-forget: a Redis outage never slows the collector.
 */
@Injectable()
export class RedisMetricsSink implements MetricsSink {
  private readonly logger = new Logger(RedisMetricsSink.name);
  private readonly retentionMs: number;
  private lastWarningAt = 0;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.retentionMs = config.get('METRICS_RETENTION_SEC', { infer: true }) * 1000;
  }

  public onBandwidth(warrior: WarriorRef, sample: BandwidthSample): void {
    const key = bandwidthKey(warrior.id);
    this.redis
      .multi()
      .zadd(key, sample.at, encodeSample(sample))
      .zremrangebyscore(key, '-inf', sample.at - this.retentionMs)
      .pexpire(key, this.retentionMs)
      .exec()
      .catch((error: Error) => this.warn(error));
  }

  public onItemFinished(): void {
    // Item outcomes are counted in memory for v0.1; a durable counter can live here later.
  }

  private warn(error: Error): void {
    const now = Date.now();
    if (now - this.lastWarningAt < 30_000) return;
    this.lastWarningAt = now;
    this.logger.warn(`metrics write failed: ${error.message}`);
  }
}
