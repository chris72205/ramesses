import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/** Extend the lease only while we still hold it. */
export const RENEW_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";
/** Release the lease only if it is still ours. */
export const RELEASE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

/** The subset of ioredis the election uses; tests pass a fake. The listener hooks are optional for fakes. */
export type LeaderRedis = Pick<Redis, 'set' | 'eval'> & {
  on?(event: 'ready', listener: () => void): unknown;
  off?(event: 'ready', listener: () => void): unknown;
};

/**
 * Picks one leader among the running server replicas with a Redis key that expires.
 *
 * Every replica tries `SET key id NX PX ttl` on each tick. The holder renews the TTL on the
 * same cadence, but only while the key still carries its id (compare-and-extend), so a lease
 * that expired and was taken by someone else is never stolen back. When the holder stops
 * renewing (crash, partition, eviction) the key expires within one TTL and the next tick of
 * another replica wins. A clean shutdown deletes the key so the handover does not wait.
 *
 * Emits `elected` and `lost`. Jobs that must run once across the fleet (tracker sampling,
 * pruning) start on `elected` and stop on `lost`.
 */
@Injectable()
export class LeaderElectionService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderElectionService.name);
  readonly key: string;
  readonly instanceId: string;
  private readonly ttlMs: number;
  private readonly renewMs: number;
  private leader = false;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;
  private redisDown = false;
  /** The client connects lazily; compete as soon as it is usable instead of a tick later. */
  private readonly onReady = (): void => void this.tick();

  constructor(
    @Inject(REDIS) private readonly redis: LeaderRedis,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.key = `${config.get('REDIS_KEY_PREFIX', { infer: true })}:leader`;
    this.ttlMs = config.get('LEADER_TTL_MS', { infer: true });
    this.renewMs = config.get('LEADER_RENEW_MS', { infer: true });
    this.instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  }

  public get isLeader(): boolean {
    return this.leader;
  }

  public onModuleInit(): void {
    this.start();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Begin competing. Calling it while already running is a no-op; `stop()` ends it. */
  public start(): void {
    this.stopped = false;
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.renewMs);
    this.redis.on?.('ready', this.onReady);
  }

  /** Stop competing and release the lease if we hold it. */
  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.redis.off?.('ready', this.onReady);
    if (!this.leader) return;
    await this.redis
      .eval(RELEASE_SCRIPT, 1, this.key, this.instanceId)
      .catch((error: Error) => this.logger.debug(`release failed: ${error.message}`));
    this.lose('released');
  }

  /** One election round: renew when leading, otherwise try to acquire. Public for tests. */
  public async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      if (this.leader) {
        const extended = await this.redis.eval(
          RENEW_SCRIPT,
          1,
          this.key,
          this.instanceId,
          String(this.ttlMs),
        );
        if (extended !== 1) this.lose('lease taken over or expired');
      } else {
        const reply = await this.redis.set(this.key, this.instanceId, 'PX', this.ttlMs, 'NX');
        if (reply === 'OK') {
          this.leader = true;
          this.logger.log(`elected leader as ${this.instanceId}`);
          this.emit('elected');
        }
      }
      this.redisDown = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.leader) this.lose(`redis error: ${message}`);
      else if (!this.redisDown) this.logger.debug(`election skipped: ${message}`);
      this.redisDown = true;
    } finally {
      this.ticking = false;
    }
  }

  private lose(reason: string): void {
    if (!this.leader) return;
    this.leader = false;
    this.logger.warn(`lost leadership (${reason})`);
    this.emit('lost');
  }
}
