import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env';

export const REDIS = Symbol('REDIS');

/**
 * Redis has no feature role in v0.1. The client is wired in so later features (pub/sub
 * across backend replicas, caching tracker data, rate limiting) can inject it, and so the
 * readiness check reports it. Boot never blocks on Redis; ioredis reconnects on its own.
 */
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit(): void {
    this.redis.on('error', (error: Error) => this.logger.warn(`Redis: ${error.message}`));
    this.redis.on('ready', () => this.logger.log('Redis connected'));
    this.redis.connect().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
