import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { TrackerKind } from '@ramesses/shared';

/** A catalog entry from the tracker's project list, kept after the project retires. */
@Entity({ name: 'projects' })
export class Project {
  @PrimaryColumn({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ type: 'text', nullable: true })
  logo!: string | null;

  @Column({ type: 'text', nullable: true })
  leaderboard!: string | null;

  @Column({ type: 'text', nullable: true })
  repository!: string | null;

  @Column({ type: 'text', default: 'unknown' })
  tracker!: TrackerKind;

  @Column({ name: 'is_auto', type: 'boolean', default: false })
  isAuto!: boolean;

  @Column({ type: 'boolean', default: false })
  listed!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deadline!: Date | null;

  @Column({ name: 'first_seen_at', type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  @Column({ name: 'last_sampled_at', type: 'timestamptz', nullable: true })
  lastSampledAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
