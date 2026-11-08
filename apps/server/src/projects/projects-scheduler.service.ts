import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { RefreshResult } from '@ramesses/shared';
import type { Env } from '../config/env';
import { LeaderElectionService } from '../leader/leader-election.service';
import { REDIS, REDIS_SUBSCRIBER } from '../redis/redis.module';
import { ProjectsSampler } from './projects-sampler.service';

/** Each scheduled delay is stretched or shrunk by up to this fraction. */
export const JITTER = 0.1;

/** The subset of ioredis the scheduler uses on the command connection. */
export type SchedulerRedis = Pick<Redis, 'get' | 'set' | 'publish'>;
/** The subset used on the subscriber connection, loose enough for a fake emitter in tests. */
export interface SchedulerSubscriber {
  readonly status: string;
  subscribe(...channels: string[]): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  on(event: 'ready', listener: () => void): unknown;
}

/**
 * Decides when a sample run happens and on which replica.
 *
 * Only the leader samples. On election it looks at the last run time shared in Redis, so a
 * restart neither samples twice nor waits a whole interval, then runs on the configured
 * interval with jitter. A manual refresh from any replica is published on a Redis channel;
 * the leader picks it up and runs if the throttle allows. After every run the leader records
 * the run time and publishes an `updated` notice for every replica's connected browsers.
 */
@Injectable()
export class ProjectsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsScheduler.name);
  readonly enabled: boolean;
  readonly lastRunKey: string;
  readonly refreshChannel: string;
  readonly updatedChannel: string;
  private readonly intervalMs: number;
  private readonly minGapMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly onElected = () => void this.scheduleNext(true);
  private readonly onLost = () => this.clearTimer();

  constructor(
    private readonly sampler: ProjectsSampler,
    private readonly election: LeaderElectionService,
    @Inject(REDIS) private readonly redis: SchedulerRedis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: SchedulerSubscriber,
    config: ConfigService<Env, true>,
  ) {
    const prefix = config.get('REDIS_KEY_PREFIX', { infer: true });
    this.lastRunKey = `${prefix}:projects:last-run`;
    this.refreshChannel = `${prefix}:projects:refresh`;
    this.updatedChannel = `${prefix}:projects:updated`;
    this.enabled = config.get('PROJECTS_SAMPLING_ENABLED', { infer: true });
    this.intervalMs = config.get('PROJECTS_SAMPLE_INTERVAL_SEC', { infer: true }) * 1000;
    this.minGapMs = config.get('PROJECTS_REFRESH_MIN_SEC', { infer: true }) * 1000;
  }

  public onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('tracker sampling is disabled');
      return;
    }
    this.election.on('elected', this.onElected);
    this.election.on('lost', this.onLost);
    if (this.election.isLeader) this.onElected();
    this.subscriber.on('message', (channel: string, _message: string) => {
      if (channel === this.refreshChannel && this.election.isLeader) void this.sample('manual');
    });
    const subscribe = () =>
      this.subscriber
        .subscribe(this.refreshChannel)
        .catch((error: Error) => this.logger.debug(`subscribe failed: ${error.message}`));
    this.subscriber.on('ready', () => void subscribe());
    if (this.subscriber.status === 'ready') void subscribe();
  }

  public onModuleDestroy(): void {
    this.election.off('elected', this.onElected);
    this.election.off('lost', this.onLost);
    this.clearTimer();
  }

  /**
   * Ask the leader for a run now. Throttled by the shared last-run time so every replica
   * answers the same way; the leader re-checks before running.
   */
  public async requestRefresh(now = Date.now()): Promise<RefreshResult> {
    const lastRun = await this.lastRunAt();
    const nextAllowed = lastRun === null ? now : lastRun + this.minGapMs;
    if (now < nextAllowed) {
      return {
        requested: false,
        lastRunAt: new Date(lastRun!).toISOString(),
        nextAllowedAt: new Date(nextAllowed).toISOString(),
      };
    }
    await this.redis.publish(this.refreshChannel, String(now));
    return {
      requested: true,
      lastRunAt: lastRun === null ? null : new Date(lastRun).toISOString(),
      nextAllowedAt: new Date(now + this.minGapMs).toISOString(),
    };
  }

  /** Epoch ms of the last completed run on any replica, or null. */
  public async lastRunAt(): Promise<number | null> {
    const value = await this.redis.get(this.lastRunKey).catch(() => null);
    const parsed = value === null ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** Run a sample if the throttle allows, then reschedule. Public for tests. */
  public async sample(reason: 'scheduled' | 'manual'): Promise<boolean> {
    if (this.running || !this.election.isLeader) return false;
    this.running = true;
    let attempted = false;
    try {
      const now = Date.now();
      const lastRun = await this.lastRunAt();
      // A throttled manual request changes nothing, including the next scheduled run.
      if (reason === 'manual' && lastRun !== null && now - lastRun < this.minGapMs) return false;
      attempted = true;
      await this.sampler.runOnce(new Date(now));
      await this.redis.set(this.lastRunKey, String(now));
      await this.redis.publish(this.updatedChannel, String(now));
      return true;
    } catch (error) {
      this.logger.error(
        `sample run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      this.running = false;
      if (attempted && this.election.isLeader) void this.scheduleNext(false);
    }
  }

  /**
   * Arm the timer for the next run. Right after election the delay is whatever is left of the
   * interval since the last run anywhere; afterwards it is a full interval. Public for tests.
   */
  public async scheduleNext(afterElection: boolean): Promise<void> {
    this.clearTimer();
    if (!this.election.isLeader) return;
    let delay = this.intervalMs;
    if (afterElection) {
      const lastRun = await this.lastRunAt();
      delay = lastRun === null ? 0 : Math.max(0, lastRun + this.intervalMs - Date.now());
    }
    const jittered = Math.round(delay * (1 - JITTER + Math.random() * 2 * JITTER));
    this.timer = setTimeout(() => void this.sample('scheduled'), jittered);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
