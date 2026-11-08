import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshot, type WarriorSnapshot } from '@ramesses/shared';
import type { FleetService } from '../fleet/fleet.service';
import type { Warrior } from '../warriors/warrior.entity';
import type { WarriorsService } from '../warriors/warriors.service';
import { WarriorControlError, type WarriorControlClient } from './warrior-control-client';
import { WarriorControlsService } from './warrior-controls.service';

const record = (overrides: Partial<Warrior> = {}): Warrior =>
  ({ id: 'w1', name: 'one', host: '10.0.0.1', port: 8001, enabled: true, ...overrides }) as Warrior;

describe('WarriorControlsService', () => {
  let warrior: Warrior;
  let snapshot: WarriorSnapshot | undefined;
  let client: {
    selectProject: ReturnType<typeof vi.fn>;
    deselectProject: ReturnType<typeof vi.fn>;
    readSettings: ReturnType<typeof vi.fn>;
    updateSettings: ReturnType<typeof vi.fn>;
  };
  let resync: ReturnType<typeof vi.fn>;
  let service: WarriorControlsService;

  beforeEach(() => {
    warrior = record();
    snapshot = createSnapshot(warrior, 0);
    snapshot.catalog = {
      telegram: { name: 'telegram', title: 'Telegram' } as WarriorSnapshot['catalog'][string],
    };
    client = {
      selectProject: vi.fn(async () => undefined),
      deselectProject: vi.fn(async () => undefined),
      readSettings: vi.fn(async () => ({ downloader: 'fake', concurrentItems: 2 })),
      updateSettings: vi.fn(async () => ({
        ok: true,
        errors: {},
        settings: { downloader: 'fake', concurrentItems: 3 },
      })),
    };
    resync = vi.fn();
    const warriors = {
      findOne: vi.fn(async (id: string) => {
        if (id !== warrior.id) throw new NotFoundException();
        return warrior;
      }),
    } as unknown as WarriorsService;
    const fleet = { snapshot: () => snapshot, resync } as unknown as FleetService;
    service = new WarriorControlsService(
      warriors,
      fleet,
      client as unknown as WarriorControlClient,
    );
  });

  it('selects a project from the catalog and resyncs the warrior', async () => {
    const accepted = await service.selectProject('w1', 'telegram');
    expect(client.selectProject).toHaveBeenCalledWith({ host: '10.0.0.1', port: 8001 }, 'telegram');
    expect(resync).toHaveBeenCalledWith('w1');
    expect(accepted).toMatchObject({ id: 'w1', command: 'select_project' });
    expect(Date.parse(accepted.acceptedAt)).not.toBeNaN();
  });

  it('refuses names outside the catalog, including auto, before posting', async () => {
    await expect(service.selectProject('w1', 'auto')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.selectProject('w1', 'nope')).rejects.toBeInstanceOf(BadRequestException);
    expect(client.selectProject).not.toHaveBeenCalled();
    expect(resync).not.toHaveBeenCalled();
  });

  it('refuses to select before the catalog has arrived', async () => {
    snapshot!.catalog = {};
    await expect(service.selectProject('w1', 'telegram')).rejects.toBeInstanceOf(ConflictException);
    expect(client.selectProject).not.toHaveBeenCalled();
  });

  it('rejects unknown, disabled, and untracked warriors', async () => {
    await expect(service.deselectProject('w9')).rejects.toBeInstanceOf(NotFoundException);
    warrior = record({ enabled: false });
    await expect(service.deselectProject('w1')).rejects.toBeInstanceOf(ConflictException);
    warrior = record();
    snapshot = undefined;
    await expect(service.deselectProject('w1')).rejects.toBeInstanceOf(ConflictException);
    expect(client.deselectProject).not.toHaveBeenCalled();
  });

  it('deselects and resyncs', async () => {
    const accepted = await service.deselectProject('w1');
    expect(client.deselectProject).toHaveBeenCalledWith({ host: '10.0.0.1', port: 8001 });
    expect(accepted.command).toBe('deselect_project');
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('maps control failures to 502 and does not resync', async () => {
    for (const [kind, text] of [
      ['unreachable', /Could not reach one \(10\.0\.0\.1:8001\): ECONNREFUSED/],
      ['unauthorized', /requires a username and password/],
      ['rejected', /warrior answered HTTP 500/],
      ['unexpected_body', /did not acknowledge/],
    ] as const) {
      client.deselectProject.mockRejectedValueOnce(
        new WarriorControlError(
          kind,
          kind === 'unreachable'
            ? 'ECONNREFUSED'
            : kind === 'rejected'
              ? 'warrior answered HTTP 500'
              : kind === 'unexpected_body'
                ? 'warrior did not acknowledge deselect-project: empty body'
                : 'warrior requires credentials',
        ),
      );
      const error = await service.deselectProject('w1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as Error).message).toMatch(text);
    }
    expect(resync).not.toHaveBeenCalled();
  });

  it('lets unexpected errors through untouched', async () => {
    client.deselectProject.mockRejectedValueOnce(new Error('bug'));
    await expect(service.deselectProject('w1')).rejects.toThrow('bug');
  });

  it('reads settings without resyncing', async () => {
    expect(await service.readSettings('w1')).toEqual({ downloader: 'fake', concurrentItems: 2 });
    expect(resync).not.toHaveBeenCalled();
  });

  it('translates settings fields to the warrior keys and requires at least one', async () => {
    await service.updateSettings('w1', { concurrentItems: 3 });
    expect(client.updateSettings).toHaveBeenCalledWith(
      { host: '10.0.0.1', port: 8001 },
      { concurrent_items: '3' },
    );
    await service.updateSettings('w1', { downloader: 'nick', concurrentItems: 1 });
    expect(client.updateSettings).toHaveBeenLastCalledWith(expect.anything(), {
      downloader: 'nick',
      concurrent_items: '1',
    });
    expect(resync).toHaveBeenCalledTimes(2);
    await expect(service.updateSettings('w1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('turns a warrior-side settings rejection into 422 with per-field messages', async () => {
    client.updateSettings.mockResolvedValueOnce({
      ok: false,
      errors: { concurrent_items: 'Number must be 6 or smaller.' },
      settings: { downloader: 'fake', concurrentItems: 2 },
    });
    const error = await service
      .updateSettings('w1', { concurrentItems: 6 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      message: ['concurrentItems: Number must be 6 or smaller.'],
      fields: { concurrentItems: 'Number must be 6 or smaller.' },
    });
    expect(resync).not.toHaveBeenCalled();
  });
});
