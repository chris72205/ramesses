import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';
import { WarriorsStore } from './warriors.svelte';

const mocks = vi.hoisted(() => ({ listWarriors: vi.fn() }));
vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, ...mocks } };
});

describe('WarriorsStore', () => {
  afterEach(() => mocks.listWarriors.mockReset());

  it('loads records and clears a previous error', async () => {
    const store = new WarriorsStore();
    expect(store.records).toBeNull();
    mocks.listWarriors.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await store.load();
    expect(store.error).toBe('ECONNREFUSED');
    expect(store.records).toBeNull();
    mocks.listWarriors.mockResolvedValueOnce([{ id: '1' }]);
    await store.load();
    expect(store.records).toEqual([{ id: '1' }]);
    expect(store.error).toBeNull();
  });
});
