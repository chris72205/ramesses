import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WarriorSnapshot } from '@ramesses/shared';
import { api, ApiError } from './api';
import { ControlsStore, PENDING_TIMEOUT_MS } from './controls.svelte';

const accepted = {
  id: 'w1',
  command: 'select_project' as const,
  acceptedAt: '2026-01-01T00:00:00Z',
};

function snapshot(overrides: Partial<WarriorSnapshot> = {}): WarriorSnapshot {
  return {
    id: 'w1',
    name: 'warrior-1',
    host: '192.0.2.10',
    port: 8001,
    enabled: true,
    connection: { state: 'connected', lastSeenAt: 1, connectedAt: 1, lastError: null, attempts: 0 },
    instanceId: '1',
    status: 'RUNNING_PROJECT',
    runnerStatus: 'running',
    project: { title: 'Telegram', name: 'telegram', logo: null, leaderboard: null, deadline: null },
    items: [],
    bandwidth: null,
    bandwidthHistory: [],
    counters: { completed: 0, failed: 0, canceled: 0 },
    broadcastMessage: null,
    catalog: {
      telegram: {
        name: 'telegram',
        title: 'Telegram',
        description: '',
        logo: '',
        leaderboard: '',
        repository: '',
      },
      blogger: {
        name: 'blogger',
        title: 'Blogger',
        description: '',
        logo: '',
        leaderboard: '',
        repository: '',
      },
    },
    rolling: null,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ControlsStore', () => {
  let store: ControlsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new ControlsStore();
    vi.spyOn(api, 'selectProject').mockResolvedValue(accepted);
    vi.spyOn(api, 'deselectProject').mockResolvedValue({
      ...accepted,
      command: 'deselect_project',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('marks a project switch pending until the warrior runs the new project', async () => {
    const warrior = snapshot();
    await expect(store.selectProject(warrior, 'blogger')).resolves.toBe(true);
    expect(api.selectProject).toHaveBeenCalledWith('w1', 'blogger');
    expect(store.pending['w1']).toMatchObject({
      command: 'select_project',
      name: 'blogger',
      label: 'Switching to Blogger…',
      transitioned: false,
    });

    // The warrior announces the new project before it has stopped the old one.
    store.settle(snapshot({ project: { ...warrior.project!, name: 'blogger', title: 'Blogger' } }));
    expect(store.pending['w1']).toBeDefined();

    store.settle(snapshot({ status: 'STOPPING_PROJECT' }));
    expect(store.pending['w1']?.transitioned).toBe(true);
    store.settle(snapshot({ status: 'STARTING_PROJECT', project: null }));
    expect(store.pending['w1']).toBeDefined();

    store.settle(snapshot({ project: { ...warrior.project!, name: 'blogger', title: 'Blogger' } }));
    expect(store.pending['w1']).toBeUndefined();
  });

  it('clears a switch from idle as soon as the new project runs', async () => {
    await store.selectProject(snapshot({ status: 'NO_PROJECT', project: null }), 'telegram');
    expect(store.pending['w1']?.transitioned).toBe(true);
    store.settle(snapshot({ status: 'STARTING_PROJECT' }));
    expect(store.pending['w1']).toBeDefined();
    store.settle(snapshot());
    expect(store.pending['w1']).toBeUndefined();
  });

  it('falls back to the catalog key when the title is unknown', async () => {
    await store.selectProject(snapshot({ catalog: {} }), 'mystery');
    expect(store.pending['w1']?.label).toBe('Switching to mystery…');
  });

  it('marks a stop pending until the warrior is idle', async () => {
    await expect(store.deselectProject(snapshot())).resolves.toBe(true);
    expect(api.deselectProject).toHaveBeenCalledWith('w1');
    expect(store.pending['w1']?.label).toBe('Stopping work…');
    store.settle(snapshot({ status: 'STOPPING_PROJECT' }));
    expect(store.pending['w1']).toBeDefined();
    store.settle(snapshot({ status: 'NO_PROJECT', project: null }));
    expect(store.pending['w1']).toBeUndefined();
  });

  it('records the server error and drops the pending entry when a request fails', async () => {
    vi.mocked(api.deselectProject).mockRejectedValue(new ApiError(502, 'Could not reach it'));
    await expect(store.deselectProject(snapshot())).resolves.toBe(false);
    expect(store.pending['w1']).toBeUndefined();
    expect(store.errors['w1']).toBe('Could not reach it');
    store.dismissError('w1');
    expect(store.errors['w1']).toBeUndefined();
  });

  it('stringifies a non-Error rejection', async () => {
    vi.mocked(api.selectProject).mockRejectedValue('boom');
    await store.selectProject(snapshot(), 'blogger');
    expect(store.errors['w1']).toBe('boom');
  });

  it('forgets a pending entry after the timeout', async () => {
    await store.selectProject(snapshot(), 'blogger');
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 1);
    expect(store.pending['w1']).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(store.pending['w1']).toBeUndefined();
  });

  it('restarts the timeout when a new request replaces a pending one', async () => {
    await store.selectProject(snapshot(), 'blogger');
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 1000);
    await store.deselectProject(snapshot());
    vi.advanceTimersByTime(2000);
    expect(store.pending['w1']?.command).toBe('deselect_project');
  });

  it('ignores snapshots of warriors with nothing pending', () => {
    store.settle(snapshot());
    expect(store.pending).toEqual({});
  });
});
