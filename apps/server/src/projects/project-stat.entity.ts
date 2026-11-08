import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Postgres returns bigint as text; every count fits a JS number (the largest is about 2^38). */
const bigintToNumber = {
  to: (value: number) => value,
  from: (value: string | number) => Number(value),
};

/** One tracker reading for one project. Append-only; pruned by retention. */
@Entity({ name: 'project_stats' })
@Index('ix_project_stats_project_sampled', ['projectName', 'sampledAt'])
export class ProjectStat {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'project_name', type: 'text' })
  projectName!: string;

  @Column({ name: 'sampled_at', type: 'timestamptz' })
  sampledAt!: Date;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  todo!: number;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  out!: number;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  done!: number;

  @Column({ type: 'double precision', nullable: true })
  rcr!: number | null;

  @Column({ name: 'downloader_count', type: 'integer', default: 0 })
  downloaderCount!: number;
}
