import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ControlAccepted,
  UpdateWarriorSettingsInput,
  WarriorControlCommand,
  WarriorSettings,
  WarriorSnapshot,
} from '@ramesses/shared';
import { FleetService } from '../fleet/fleet.service';
import type { Warrior } from '../warriors/warrior.entity';
import { WarriorsService } from '../warriors/warriors.service';
import {
  WARRIOR_CONTROL_CLIENT,
  WarriorControlClient,
  WarriorControlError,
  type WarriorAddress,
} from './warrior-control-client';

/** Config keys on the warrior for the settings Ramesses edits. */
const SETTING_KEYS: Record<keyof UpdateWarriorSettingsInput, string> = {
  downloader: 'downloader',
  concurrentItems: 'concurrent_items',
};
const SETTING_FIELDS = Object.keys(SETTING_KEYS) as Array<keyof UpdateWarriorSettingsInput>;

/**
 * Applies Ramesses's rules to a control request, posts it to the warrior, and asks the fleet to
 * resync that warrior so browsers get a fresh snapshot alongside the events that follow.
 */
@Injectable()
export class WarriorControlsService {
  private readonly logger = new Logger(WarriorControlsService.name);

  constructor(
    private readonly warriors: WarriorsService,
    private readonly fleet: FleetService,
    @Inject(WARRIOR_CONTROL_CLIENT) private readonly client: WarriorControlClient,
  ) {}

  public async selectProject(id: string, name: string): Promise<ControlAccepted> {
    const { warrior, snapshot } = await this.target(id);
    // The warrior saves any name it is given and treats an unknown one as "no project", so only
    // names from its own catalog may go out. `auto` (the tracker's pick) is never offered: a fleet
    // choosing by itself could pile onto one project.
    if (Object.keys(snapshot.catalog).length === 0) {
      throw new ConflictException(
        `${warrior.name} has not sent its project catalog yet; wait for it to connect`,
      );
    }
    if (!(name in snapshot.catalog)) {
      throw new BadRequestException(`${warrior.name} does not list a project named "${name}"`);
    }
    await this.call(warrior, () => this.client.selectProject(address(warrior), name));
    return this.accepted(id, 'select_project');
  }

  public async deselectProject(id: string): Promise<ControlAccepted> {
    const { warrior } = await this.target(id);
    await this.call(warrior, () => this.client.deselectProject(address(warrior)));
    return this.accepted(id, 'deselect_project');
  }

  public async readSettings(id: string): Promise<WarriorSettings> {
    const { warrior } = await this.target(id);
    return this.call(warrior, () => this.client.readSettings(address(warrior)));
  }

  public async updateSettings(
    id: string,
    input: UpdateWarriorSettingsInput,
  ): Promise<ControlAccepted> {
    const { warrior } = await this.target(id);
    const values: Record<string, string> = {};
    for (const field of SETTING_FIELDS) {
      const value = input[field];
      if (value !== undefined) values[SETTING_KEYS[field]] = String(value);
    }
    if (Object.keys(values).length === 0) {
      throw new BadRequestException('nothing to change: send downloader, concurrentItems, or both');
    }
    const result = await this.call(warrior, () =>
      this.client.updateSettings(address(warrior), values),
    );
    if (!result.ok) {
      const fields = Object.fromEntries(
        Object.entries(result.errors).map(([key, message]) => [fieldFor(key), message]),
      );
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: Object.entries(fields).map(([field, message]) => `${field}: ${message}`),
        fields,
      });
    }
    return this.accepted(id, 'update_settings');
  }

  private async target(id: string): Promise<{ warrior: Warrior; snapshot: WarriorSnapshot }> {
    const warrior = await this.warriors.findOne(id);
    if (!warrior.enabled) {
      throw new ConflictException(`${warrior.name} is disabled; enable it under Settings first`);
    }
    const snapshot = this.fleet.snapshot(id);
    if (!snapshot) throw new ConflictException(`${warrior.name} is not being tracked yet`);
    return { warrior, snapshot };
  }

  /** Run one client call, translating warrior-side failures into gateway errors. */
  private async call<T>(warrior: Warrior, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof WarriorControlError)) throw error;
      this.logger.warn(
        `${warrior.host}:${warrior.port} control failed (${error.kind}): ${error.message}`,
      );
      const where = `${warrior.name} (${warrior.host}:${warrior.port})`;
      switch (error.kind) {
        case 'unreachable':
          throw new BadGatewayException(`Could not reach ${where}: ${error.message}`);
        case 'unauthorized':
          throw new BadGatewayException(
            `${where} requires a username and password, which Ramesses cannot send yet`,
          );
        default:
          throw new BadGatewayException(`${where}: ${error.message}`);
      }
    }
  }

  private accepted(id: string, command: WarriorControlCommand): ControlAccepted {
    this.fleet.resync(id);
    return { id, command, acceptedAt: new Date().toISOString() };
  }
}

function address(warrior: Warrior): WarriorAddress {
  return { host: warrior.host, port: warrior.port };
}

function fieldFor(key: string): string {
  return SETTING_FIELDS.find((field) => SETTING_KEYS[field] === key) ?? key;
}
