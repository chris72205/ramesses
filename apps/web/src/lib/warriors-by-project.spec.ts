import { describe, expect, it } from 'vitest';
import { createSnapshot, type WarriorSnapshot } from '@ramesses/shared';
import { groupWarriorsByProject } from './warriors-by-project';

function warrior(
  id: string,
  project: string | null,
  overrides: Partial<WarriorSnapshot> = {},
): WarriorSnapshot {
  const snapshot = createSnapshot({ id, name: id, host: 'h', port: 8001, enabled: true }, 0);
  snapshot.project = project
    ? { title: project, name: project, logo: null, leaderboard: null, deadline: null }
    : null;
  snapshot.connection.state = 'connected';
  snapshot.status = 'RUNNING_PROJECT';
  return { ...snapshot, ...overrides };
}

describe('groupWarriorsByProject', () => {
  it('groups enabled warriors by catalog key, sorted naturally, with item counts', () => {
    const b = warrior('w10', 'blogger');
    b.items = [
      {
        id: '1',
        name: 'x',
        status: 'running',
        startedAt: 0,
        finishedAt: null,
        log: [],
        tasks: [],
      } as never,
      {
        id: '2',
        name: 'y',
        status: 'finished',
        startedAt: 0,
        finishedAt: 1,
        log: [],
        tasks: [],
      } as never,
    ];
    const groups = groupWarriorsByProject([
      b,
      warrior('w2', 'blogger', { connection: { ...b.connection, state: 'offline' } }),
      warrior('w3', 'telegram'),
      warrior('w4', null),
      warrior('w5', 'blogger', { enabled: false }),
      warrior('w6', 'unknown-title-only', {
        project: { title: 'Mystery', name: null, logo: null, leaderboard: null, deadline: null },
      }),
    ]);
    expect([...groups.keys()].sort()).toEqual(['blogger', 'telegram']);
    expect(groups.get('blogger')!.map((w) => w.name)).toEqual(['w2', 'w10']);
    expect(groups.get('blogger')![1]).toMatchObject({
      connected: true,
      runningItems: 1,
      status: 'RUNNING_PROJECT',
    });
    expect(groups.get('blogger')![0]!.connected).toBe(false);
    expect(groups.get('telegram')).toHaveLength(1);
  });

  it('is empty for an empty fleet', () => {
    expect(groupWarriorsByProject([]).size).toBe(0);
  });
});
