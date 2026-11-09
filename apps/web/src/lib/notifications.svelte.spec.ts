import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEOUT_MS, MAX_NOTIFICATIONS, NotificationsStore } from './notifications.svelte';

describe('NotificationsStore', () => {
  let store: NotificationsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new NotificationsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds notices oldest first with their level and timeout', () => {
    const first = store.success('Saved');
    const second = store.info('Sampled', 1_000);
    const third = store.error('Failed');
    expect(store.items.map((n) => n.id)).toEqual([first, second, third]);
    expect(store.items[0]).toMatchObject({
      level: 'success',
      message: 'Saved',
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(store.items[1]).toMatchObject({ level: 'info', timeout: 1_000 });
    expect(store.items[2]).toMatchObject({ level: 'error', timeout: null });
  });

  it('dismisses success and info notices by itself and keeps errors', () => {
    store.success('Saved');
    store.info('Sampled', 1_000);
    store.error('Failed');
    vi.advanceTimersByTime(1_000);
    expect(store.items.map((n) => n.message)).toEqual(['Saved', 'Failed']);
    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 1_000);
    expect(store.items.map((n) => n.message)).toEqual(['Failed']);
    vi.advanceTimersByTime(60_000);
    expect(store.items.map((n) => n.message)).toEqual(['Failed']);
  });

  it('dismisses on request and forgets the timer', () => {
    const id = store.success('Saved');
    store.dismiss(id);
    expect(store.items).toEqual([]);
    store.dismiss(id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops the oldest notice once the list is full', () => {
    for (let i = 0; i < MAX_NOTIFICATIONS; i++) store.error(`e${i}`);
    expect(store.items).toHaveLength(MAX_NOTIFICATIONS);
    store.success('newest');
    expect(store.items).toHaveLength(MAX_NOTIFICATIONS);
    expect(store.items[0]?.message).toBe('e1');
    expect(store.items.at(-1)?.message).toBe('newest');
  });

  it('clears everything, timers included', () => {
    store.success('a');
    store.success('b');
    store.clear();
    expect(store.items).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
