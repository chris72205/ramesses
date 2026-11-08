import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderElectionService } from '../leader/leader-election.service';
import type { ProjectsSampler } from './projects-sampler.service';
import {
  JITTER,
  ProjectsScheduler,
  type SchedulerRedis,
  type SchedulerSubscriber,
} from './projects-scheduler.service';

const INTERVAL_SEC = 900;
const MIN_GAP_SEC = 300;

function makeConfig(enabled = true) {
  return {
    get: (key: string) =>
      ({
        REDIS_KEY_PREFIX: 'test',
        PROJECTS_SAMPLING_ENABLED: enabled,
        PROJECTS_SAMPLE_INTERVAL_SEC: INTERVAL_SEC,
        PROJECTS_REFRESH_MIN_SEC: MIN_GAP_SEC,
      })[key],
  } as unknown as ConfigService<Env, true>;
}

class FakeElection extends EventEmitter {
  isLeader = false;
  public elect() {
    this.isLeader = true;
    this.emit('elected');
  }
  public lose() {
    this.isLeader = false;
    this.emit('lost');
  }
}

class FakeSubscriber extends EventEmitter implements SchedulerSubscriber {
  status = 'ready';
  subscribe = vi.fn(async () => 1) as unknown as SchedulerSubscriber['subscribe'];
}

describe('ProjectsScheduler', () => {
  let store: Map<string, string>;
  let published: Array<[string, string]>;
  let redis: SchedulerRedis;
  let subscriber: FakeSubscriber;
  let election: FakeElection;
  let runOnce: ReturnType<typeof vi.fn>;
  let scheduler: ProjectsScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter
    store = new Map();
    published = [];
    redis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      publish: vi.fn(async (channel: string, message: string) => {
        published.push([channel, message]);
        return 1;
      }),
    } as unknown as SchedulerRedis;
    subscriber = new FakeSubscriber();
    election = new FakeElection();
    runOnce = vi.fn(async () => ({
      sampledAt: '',
      catalog: 1,
      sampled: 1,
      failed: 0,
      pruned: 0,
    }));
    scheduler = new ProjectsScheduler(
      { runOnce } as unknown as ProjectsSampler,
      election as unknown as LeaderElectionService,
      redis,
      subscriber,
      makeConfig(),
    );
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing until elected, then samples right away when nothing ran before', async () => {
    scheduler.onModuleInit();
    expect(subscriber.subscribe).toHaveBeenCalledWith('test:projects:refresh');
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(runOnce).not.toHaveBeenCalled();
    election.elect();
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(store.get('test:projects:last-run')).toBe(String(Date.now()));
    expect(published).toEqual([['test:projects:updated', String(Date.now())]]);
    // then once per interval
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('waits out the remainder of the interval after a recent run elsewhere', async () => {
    store.set('test:projects:last-run', String(Date.now() - 600_000));
    scheduler.onModuleInit();
    election.elect();
    await vi.advanceTimersByTimeAsync(299_000);
    expect(runOnce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('applies jitter within ±10% of the delay', async () => {
    (Math.random as ReturnType<typeof vi.fn>).mockReturnValue(1);
    scheduler.onModuleInit();
    election.elect();
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    const stretched = INTERVAL_SEC * 1000 * (1 + JITTER);
    await vi.advanceTimersByTimeAsync(stretched - 1);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('stops the timer when leadership is lost', async () => {
    scheduler.onModuleInit();
    election.elect();
    await vi.advanceTimersByTimeAsync(0);
    election.lose();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000 * 2);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('runs on a refresh message only as leader and only outside the throttle', async () => {
    scheduler.onModuleInit();
    subscriber.emit('message', 'test:projects:refresh', '1');
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).not.toHaveBeenCalled();
    election.elect();
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    subscriber.emit('message', 'test:projects:refresh', '2');
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1); // throttled: just ran
    await vi.advanceTimersByTimeAsync(MIN_GAP_SEC * 1000);
    subscriber.emit('message', 'test:projects:refresh', '3');
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
    subscriber.emit('message', 'other', '4');
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('does not move the next scheduled run when a manual refresh is throttled', async () => {
    scheduler.onModuleInit();
    election.elect();
    await vi.advanceTimersByTimeAsync(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(await scheduler.sample('manual')).toBe(false); // last run was 4 minutes ago: throttled
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000 - 240_000 - 1);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runOnce).toHaveBeenCalledTimes(2); // the scheduled run still fires on time
  });

  it('answers refresh requests from the shared last-run time', async () => {
    const now = Date.now();
    expect(await scheduler.requestRefresh(now)).toEqual({
      requested: true,
      lastRunAt: null,
      nextAllowedAt: new Date(now + MIN_GAP_SEC * 1000).toISOString(),
    });
    expect(published).toEqual([['test:projects:refresh', String(now)]]);
    store.set('test:projects:last-run', String(now - 1000));
    expect(await scheduler.requestRefresh(now)).toEqual({
      requested: false,
      lastRunAt: new Date(now - 1000).toISOString(),
      nextAllowedAt: new Date(now - 1000 + MIN_GAP_SEC * 1000).toISOString(),
    });
    store.set('test:projects:last-run', 'garbage');
    expect((await scheduler.requestRefresh(now)).requested).toBe(true);
  });

  it('survives a failing run and does not overlap runs', async () => {
    runOnce.mockRejectedValueOnce(new Error('tracker down'));
    scheduler.onModuleInit();
    election.elect();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.has('test:projects:last-run')).toBe(false);
    let finish!: () => void;
    runOnce.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(await scheduler.sample('manual')).toBe(false); // already running
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.has('test:projects:last-run')).toBe(true);
  });

  it('subscribes once the subscriber connection becomes ready', () => {
    subscriber.status = 'connecting';
    scheduler.onModuleInit();
    expect(subscriber.subscribe).not.toHaveBeenCalled();
    subscriber.emit('ready');
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
  });

  it('stays idle when sampling is disabled', async () => {
    const disabled = new ProjectsScheduler(
      { runOnce } as unknown as ProjectsSampler,
      election as unknown as LeaderElectionService,
      redis,
      subscriber,
      makeConfig(false),
    );
    disabled.onModuleInit();
    election.elect();
    await vi.advanceTimersByTimeAsync(INTERVAL_SEC * 1000);
    expect(runOnce).not.toHaveBeenCalled();
    expect(subscriber.subscribe).not.toHaveBeenCalled();
    disabled.onModuleDestroy();
  });
});
