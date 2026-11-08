import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProjectSummary } from '@ramesses/shared';
import type { Env } from '../config/env';
import { REDIS_SUBSCRIBER } from '../redis/redis.module';
import type { SchedulerSubscriber } from './projects-scheduler.service';
import { ProjectsService } from './projects.service';

export type ProjectsListener = (projects: ProjectSummary[]) => void;

/**
 * The catalog as every connected browser should see it, kept warm on each replica.
 *
 * Loaded once at boot and again whenever the leader announces a finished sample run on the
 * Redis `updated` channel, so the gateway can put the catalog in `hello` without a database
 * round trip per connection and push a `projects` message to its clients after each sample.
 */
@Injectable()
export class ProjectsFeed implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectsFeed.name);
  readonly updatedChannel: string;
  private summaries: ProjectSummary[] = [];
  private readonly listeners = new Set<ProjectsListener>();
  private readonly onMessage = (channel: string) => {
    if (channel === this.updatedChannel) void this.refresh();
  };

  constructor(
    private readonly projects: ProjectsService,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: SchedulerSubscriber,
    config: ConfigService<Env, true>,
  ) {
    this.updatedChannel = `${config.get('REDIS_KEY_PREFIX', { infer: true })}:projects:updated`;
  }

  /** Latest summaries, every project included; browsers filter hidden ones themselves. */
  public get current(): ProjectSummary[] {
    return this.summaries;
  }

  public onModuleInit(): void {
    this.subscriber.on('message', this.onMessage);
    const subscribe = () =>
      this.subscriber
        .subscribe(this.updatedChannel)
        .catch((error: Error) => this.logger.debug(`subscribe failed: ${error.message}`));
    this.subscriber.on('ready', () => void subscribe());
    if (this.subscriber.status === 'ready') void subscribe();
    void this.refresh();
  }

  public onModuleDestroy(): void {
    this.listeners.clear();
  }

  /** Register for every refreshed catalog. Returns an unsubscribe function. */
  public subscribe(listener: ProjectsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reload from Postgres and notify listeners. Public for tests. */
  public async refresh(): Promise<void> {
    try {
      this.summaries = await this.projects.summaries(true);
    } catch (error) {
      this.logger.warn(
        `could not load projects: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(this.summaries);
      } catch (error) {
        this.logger.warn(
          `listener failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
