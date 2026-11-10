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

  it('stores the catalog as plain objects and re-derives the index on replace', () => {
    const store = new ProjectsStore();
    const first = catalog.slice(0, 2);
    store.replace(first);
    // Raw state: the summaries and their trend points are the same objects that came in, not
    // proxies, so a catalog push creates no signals per field.
    expect(store.items).toBe(first);
    expect(store.items[0]).toBe(first[0]);
    expect(store.items[0]!.trend).toBe(first[0]!.trend);
    expect(store.byName.get(first[1]!.name)).toBe(first[1]);

    const second = catalog.slice(2);
    store.replace(second);
    expect(store.items).toBe(second);
    expect(store.byName.has(first[0]!.name)).toBe(false);
    expect(store.byName.get(second[0]!.name)).toBe(second[0]);
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
