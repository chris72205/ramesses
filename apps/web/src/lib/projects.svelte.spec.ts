import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../test/project-fixtures';
import type * as ApiModule from './api';
import { ProjectsStore } from './projects.svelte';

const mocks = vi.hoisted(() => ({ listProjects: vi.fn() }));
vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, ...mocks } };
});

describe('ProjectsStore', () => {
  afterEach(() => mocks.listProjects.mockReset());

  it('loads the whole catalog once, hidden projects included', async () => {
    mocks.listProjects.mockResolvedValueOnce(catalog);
    const store = new ProjectsStore();
    expect(store.loadedAt).toBeNull();
    await store.load();
    expect(mocks.listProjects).toHaveBeenCalledWith(true);
    expect(store.items).toHaveLength(5);
    expect(store.byName.get('oldproject')?.active).toBe(false);
    expect(store.byName.get('telegram')?.isAuto).toBe(true);
    expect(store.lastSampledAt).toBe(catalog[0]!.lastSampledAt);
    expect(store.loadedAt).not.toBeNull();
  });

  it('records errors and does not overlap loads', async () => {
    let release!: (value: never[]) => void;
    mocks.listProjects.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const store = new ProjectsStore();
    const first = store.load();
    await store.load(); // ignored while the first is in flight
    release([]);
    await first;
    expect(mocks.listProjects).toHaveBeenCalledTimes(1);
    expect(store.lastSampledAt).toBeNull();

    mocks.listProjects.mockRejectedValueOnce(new Error('boom'));
    await store.load();
    expect(store.error).toBe('boom');
    expect(store.loading).toBe(false);
  });
});
