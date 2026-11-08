import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  public async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.indicators.check(key);
    try {
      const reply = await this.redis.ping();
      return reply === 'PONG' ? indicator.up() : indicator.down({ reply });
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : String(error) });
    }
  }
}
