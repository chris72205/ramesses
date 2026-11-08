import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import type { Env } from '../config/env';
import { ProjectStat } from './project-stat.entity';
import { Project } from './project.entity';
import { TRACKER_CLIENT, type TrackerCatalog, type TrackerClient } from './tracker/tracker-client';
import { parseDeadline, trackerKindFor } from './tracker/tracker-kind';

/** Parallel stats requests per run; the tracker serves thousands of leaderboard pages. */
export const STATS_CONCURRENCY = 3;

export interface SampleRunResult {
  sampledAt: string;
  /** projects in the catalog */
  catalog: number;
  /** projects whose stats were stored */
  sampled: number;
  /** projects whose stats request failed (recorded on the project row) */
  failed: number;
  /** stat rows removed by retention */
  pruned: number;
}

/**
 * One sample run: refresh the catalog, fetch every universal-tracker project's stats, store
 * one row each, prune old rows. Which replica runs it, and when, is the scheduler's business.
 */
@Injectable()
export class ProjectsSampler {
  private readonly logger = new Logger(ProjectsSampler.name);
  private readonly retentionMs: number;

  constructor(
    @Inject(TRACKER_CLIENT) private readonly tracker: TrackerClient,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectStat) private readonly stats: Repository<ProjectStat>,
    config: ConfigService<Env, true>,
  ) {
    this.retentionMs = config.get('PROJECTS_RETENTION_DAYS', { infer: true }) * 86_400_000;
  }

  public async runOnce(now = new Date()): Promise<SampleRunResult> {
    const catalog = await this.tracker.fetchCatalog();
    await this.upsertCatalog(catalog, now);
    const targets = await this.projects.find({
      where: { active: true, tracker: 'universal' },
      order: { name: 'ASC' },
    });
    const outcomes = await mapWithConcurrency(targets, STATS_CONCURRENCY, (project) =>
      this.sampleOne(project, now),
    );
    const pruned = await this.prune(now);
    const result: SampleRunResult = {
      sampledAt: now.toISOString(),
      catalog: catalog.projects.length,
      sampled: outcomes.filter(Boolean).length,
      failed: outcomes.filter((ok) => !ok).length,
      pruned,
    };
    this.logger.log(
      `sampled ${result.sampled}/${targets.length} projects (${result.failed} failed, ${pruned} rows pruned)`,
    );
    return result;
  }

  /** Insert new projects, refresh existing ones, and mark the missing ones retired. */
  private async upsertCatalog(catalog: TrackerCatalog, now: Date): Promise<void> {
    if (catalog.projects.length === 0) {
      this.logger.warn('catalog is empty; keeping the stored projects as they are');
      return;
    }
    const rows = catalog.projects.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      logo: p.logo,
      leaderboard: p.leaderboard,
      repository: p.repository,
      tracker: trackerKindFor(p.leaderboard),
      isAuto: p.name === catalog.autoProject,
      listed: Boolean(p.logo && p.leaderboard),
      active: true,
      deadline: parseDeadline(p.deadline),
      firstSeenAt: now,
      lastSeenAt: now,
    }));
    // Every catalog column is overwritten on conflict except first_seen_at, which is insert-only.
    await this.projects
      .createQueryBuilder()
      .insert()
      .values(rows)
      .orUpdate(
        [
          'title',
          'description',
          'logo',
          'leaderboard',
          'repository',
          'tracker',
          'is_auto',
          'listed',
          'active',
          'deadline',
          'last_seen_at',
        ],
        ['name'],
      )
      .execute();
    await this.projects.update(
      { name: Not(In(rows.map((r) => r.name))), active: true },
      { active: false },
    );
  }

  private async sampleOne(project: Project, now: Date): Promise<boolean> {
    try {
      const stats = await this.tracker.fetchStats(project.name);
      await this.stats.insert({
        projectName: project.name,
        sampledAt: now,
        todo: stats.todo,
        out: stats.out,
        done: stats.done,
        rcr: stats.rcr,
        downloaderCount: stats.downloaderCount,
      });
      await this.projects.update(project.name, {
        lastSampledAt: now,
        lastError: null,
        lastErrorAt: null,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${project.name}: ${message}`);
      await this.projects.update(project.name, { lastError: message, lastErrorAt: now });
      return false;
    }
  }

  private async prune(now: Date): Promise<number> {
    const result = await this.stats
      .createQueryBuilder()
      .delete()
      .where('sampled_at < :cutoff', { cutoff: new Date(now.getTime() - this.retentionMs) })
      .execute();
    return result.affected ?? 0;
  }
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order of results. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
