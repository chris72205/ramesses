import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env';

export const REDIS = Symbol('REDIS');
/** A second connection kept in subscriber mode; ioredis cannot issue commands on it. */
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

/**
 * Shared Redis clients: one for commands (metrics, leader election, publish) and one dedicated
 * to pub/sub subscriptions, because a subscribed ioredis connection accepts no other commands.
 * Boot never blocks on Redis; ioredis reconnects on its own and re-subscribes after a drop.
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
    {
      provide: REDIS_SUBSCRIBER,
      inject: [REDIS],
      useFactory: (redis: Redis) => redis.duplicate(),
    },
  ],
  exports: [REDIS, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  public onModuleInit(): void {
    this.redis.on('error', (error: Error) => this.logger.warn(`Redis: ${error.message}`));
    this.redis.on('ready', () => this.logger.log('Redis connected'));
    this.redis.connect().catch(() => undefined);
    this.subscriber.on('error', (error: Error) =>
      this.logger.warn(`Redis subscriber: ${error.message}`),
    );
    this.subscriber.connect().catch(() => undefined);
  }

  public async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.redis.quit().catch(() => undefined),
      this.subscriber.quit().catch(() => undefined),
    ]);
  }
}
