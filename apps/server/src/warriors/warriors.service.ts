import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subject, type Observable } from 'rxjs';
import { Repository } from 'typeorm';
import type { CreateWarriorInput, UpdateWarriorInput } from '@ramesses/shared';
import { Warrior } from './warrior.entity';

export const DEFAULT_WARRIOR_PORT = 8001;

export type WarriorChange =
  | { type: 'created'; warrior: Warrior }
  | { type: 'updated'; warrior: Warrior }
  | { type: 'removed'; id: string };

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class WarriorsService {
  private readonly changes = new Subject<WarriorChange>();

  constructor(@InjectRepository(Warrior) private readonly repo: Repository<Warrior>) {}

  /** Emits after every successful create, update, or remove. */
  public get changes$(): Observable<WarriorChange> {
    return this.changes.asObservable();
  }

  public findAll(): Promise<Warrior[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  public async findOne(id: string): Promise<Warrior> {
    const warrior = await this.repo.findOneBy({ id });
    if (!warrior) throw new NotFoundException(`Warrior ${id} not found`);
    return warrior;
  }

  public async create(input: CreateWarriorInput): Promise<Warrior> {
    const port = input.port ?? DEFAULT_WARRIOR_PORT;
    const warrior = this.repo.create({
      host: input.host,
      port,
      name: input.name?.trim() || `${input.host}:${port}`,
      enabled: true,
    });
    const saved = await this.save(warrior);
    this.changes.next({ type: 'created', warrior: saved });
    return saved;
  }

  public async update(id: string, input: UpdateWarriorInput): Promise<Warrior> {
    const warrior = await this.findOne(id);
    if (input.name !== undefined && input.name.trim()) warrior.name = input.name.trim();
    if (input.port !== undefined) warrior.port = input.port;
    if (input.enabled !== undefined) warrior.enabled = input.enabled;
    const saved = await this.save(warrior);
    this.changes.next({ type: 'updated', warrior: saved });
    return saved;
  }

  public async remove(id: string): Promise<void> {
    const warrior = await this.findOne(id);
    await this.repo.remove(warrior);
    this.changes.next({ type: 'removed', id });
  }

  private async save(warrior: Warrior): Promise<Warrior> {
    try {
      return await this.repo.save(warrior);
    } catch (error) {
      if (isPgError(error) && error.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(`A warrior at ${warrior.host}:${warrior.port} already exists`);
      }
      throw error;
    }
  }
}

function isPgError(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}
