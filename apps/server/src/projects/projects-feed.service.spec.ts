import { EventEmitter } from 'node:events';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { ProjectsFeed } from './projects-feed.service';
import type { SchedulerSubscriber } from './projects-scheduler.service';
import type { ProjectsService } from './projects.service';

const config = {
  get: () => 'test',
} as unknown as ConfigService<Env, true>;

class FakeSubscriber extends EventEmitter implements SchedulerSubscriber {
  status = 'ready';
  subscribe = vi.fn(async () => 1) as unknown as SchedulerSubscriber['subscribe'];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProjectsFeed', () => {
  it('loads at boot, reloads on the updated channel, and notifies listeners', async () => {
    const summaries = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'a' }])
      .mockResolvedValueOnce([{ name: 'a' }, { name: 'b' }]);
    const subscriber = new FakeSubscriber();
    const feed = new ProjectsFeed({ summaries } as unknown as ProjectsService, subscriber, config);
    const seen: unknown[] = [];
    const unsubscribe = feed.subscribe((p) => seen.push(p.length));
    feed.onModuleInit();
    await flush();
    expect(subscriber.subscribe).toHaveBeenCalledWith('test:projects:updated');
    expect(summaries).toHaveBeenCalledWith(true);
    expect(feed.current).toEqual([{ name: 'a' }]);
    expect(seen).toEqual([1]);

    subscriber.emit('message', 'test:projects:refresh', '1'); // not ours
    subscriber.emit('message', 'test:projects:updated', '2');
    await flush();
    expect(feed.current).toHaveLength(2);
    expect(seen).toEqual([1, 2]);

    unsubscribe();
    subscriber.emit('message', 'test:projects:updated', '3');
    await flush();
    expect(seen).toEqual([1, 2]);
    feed.onModuleDestroy();
  });

  it('keeps the previous catalog when a reload fails and survives a bad listener', async () => {
    const summaries = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'a' }])
      .mockRejectedValueOnce(new Error('db down'));
    const subscriber = new FakeSubscriber();
    subscriber.status = 'connecting';
    const feed = new ProjectsFeed({ summaries } as unknown as ProjectsService, subscriber, config);
    feed.subscribe(() => {
      throw new Error('listener bug');
    });
    feed.onModuleInit();
    expect(subscriber.subscribe).not.toHaveBeenCalled();
    subscriber.emit('ready');
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    await flush();
    expect(feed.current).toEqual([{ name: 'a' }]);
    await feed.refresh();
    expect(feed.current).toEqual([{ name: 'a' }]);
  });
});
