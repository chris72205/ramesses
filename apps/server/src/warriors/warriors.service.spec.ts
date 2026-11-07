import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { Warrior } from './warrior.entity';
import { WarriorsService, type WarriorChange } from './warriors.service';

function makeRepo() {
  const rows: Warrior[] = [];
  return {
    rows,
    find: vi.fn(async () => rows),
    findOneBy: vi.fn(async ({ id }: { id: string }) => rows.find((r) => r.id === id) ?? null),
    create: vi.fn((input: Partial<Warrior>) => Object.assign(new Warrior(), input)),
    save: vi.fn(async (w: Warrior) => {
      if (rows.some((r) => r !== w && r.host === w.host && r.port === w.port)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      if (!w.id) {
        w.id = `id-${rows.length + 1}`;
        w.createdAt = new Date();
        rows.push(w);
      }
      w.updatedAt = new Date();
      return w;
    }),
    remove: vi.fn(async (w: Warrior) => {
      rows.splice(rows.indexOf(w), 1);
      return w;
    }),
  };
}

describe('WarriorsService', () => {
  it('creates with defaults and emits a change', async () => {
    const repo = makeRepo();
    const service = new WarriorsService(repo as never);
    const changes: WarriorChange[] = [];
    service.changes$.subscribe((c) => changes.push(c));

    const created = await service.create({ host: '192.0.2.10' });
    expect(created.port).toBe(8001);
    expect(created.name).toBe('192.0.2.10:8001');
    expect(created.enabled).toBe(true);
    expect(changes).toEqual([{ type: 'created', warrior: created }]);
  });

  it('rejects a duplicate host and port with 409', async () => {
    const repo = makeRepo();
    const service = new WarriorsService(repo as never);
    await service.create({ host: 'a', port: 1 });
    await expect(service.create({ host: 'a', port: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates fields and emits, and 404s for unknown ids', async () => {
    const repo = makeRepo();
    const service = new WarriorsService(repo as never);
    const created = await service.create({ host: 'a', port: 1, name: 'one' });
    const updated = await service.update(created.id, { enabled: false, name: '  two ' });
    expect(updated.enabled).toBe(false);
    expect(updated.name).toBe('two');
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removes and emits the id', async () => {
    const repo = makeRepo();
    const service = new WarriorsService(repo as never);
    const changes: WarriorChange[] = [];
    service.changes$.subscribe((c) => changes.push(c));
    const created = await service.create({ host: 'a' });
    await service.remove(created.id);
    expect(repo.rows).toHaveLength(0);
    expect(changes.at(-1)).toEqual({ type: 'removed', id: created.id });
  });
});
