import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  HistoryRange,
  ProjectDetail,
  ProjectHistory,
  ProjectSample,
  ProjectSummary,
} from '@ramesses/shared';
import { DAY_MS, deriveMetrics, donePerHourSeries, type SamplePoint } from './project-metrics';
import { ProjectStat } from './project-stat.entity';
import { Project } from './project.entity';

const RANGE_MS: Record<HistoryRange, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};

/** Raw row shape from the stats queries (Postgres returns bigint as text). */
interface StatRow {
  project_name: string;
  sampled_at: Date;
  todo: string;
  out: string;
  done: string;
  downloader_count: number;
}

/** Read side of the projects area: summaries with derived metrics, and history series. */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectStat) private readonly stats: Repository<ProjectStat>,
  ) {}

  /** Every listed, active project with its latest numbers; `includeHidden` adds the rest. */
  public async summaries(includeHidden = false, now = Date.now()): Promise<ProjectSummary[]> {
    const where = includeHidden ? {} : { active: true, listed: true };
    const projects = await this.projects.find({ where, order: { title: 'ASC' } });
    return this.summarize(projects, now);
  }

  public async detail(name: string, now = Date.now()): Promise<ProjectDetail> {
    const project = await this.projects.findOneBy({ name });
    if (!project) throw new NotFoundException(`Project ${name} not found`);
    const [summary] = await this.summarize([project], now);
    return summary!;
  }

  public async history(
    name: string,
    range: HistoryRange,
    now = Date.now(),
  ): Promise<ProjectHistory> {
    if (!(await this.projects.existsBy({ name }))) {
      throw new NotFoundException(`Project ${name} not found`);
    }
    const since = new Date(now - RANGE_MS[range]);
    const resolution = range === '24h' ? 'raw' : 'hourly';
    const rows =
      resolution === 'raw'
        ? await this.stats.query<StatRow[]>(
            `SELECT project_name, sampled_at, todo, "out", done, downloader_count
               FROM project_stats WHERE project_name = $1 AND sampled_at >= $2
              ORDER BY sampled_at ASC`,
            [name, since],
          )
        : await this.stats.query<StatRow[]>(
            `SELECT project_name, sampled_at, todo, "out", done, downloader_count FROM (
               SELECT DISTINCT ON (date_trunc('hour', sampled_at))
                      project_name, sampled_at, todo, "out", done, downloader_count
                 FROM project_stats WHERE project_name = $1 AND sampled_at >= $2
                ORDER BY date_trunc('hour', sampled_at), sampled_at DESC
             ) buckets ORDER BY sampled_at ASC`,
            [name, since],
          );
    const points = rows.map(toPoint);
    const rates = donePerHourSeries(points);
    return {
      name,
      range,
      resolution,
      points: points.map((p, i) => ({ ...toSample(p), donePerHour: rates[i] ?? null })),
    };
  }

  private async summarize(projects: Project[], now: number): Promise<ProjectSummary[]> {
    if (projects.length === 0) return [];
    const names = projects.map((p) => p.name);
    const [latestRows, recentRows] = await Promise.all([
      this.stats.query<StatRow[]>(
        `SELECT DISTINCT ON (project_name) project_name, sampled_at, todo, "out", done, downloader_count
           FROM project_stats WHERE project_name = ANY($1)
          ORDER BY project_name, sampled_at DESC`,
        [names],
      ),
      this.stats.query<StatRow[]>(
        `SELECT project_name, sampled_at, todo, "out", done, downloader_count
           FROM project_stats WHERE project_name = ANY($1) AND sampled_at >= $2
          ORDER BY project_name, sampled_at ASC`,
        [names, new Date(now - DAY_MS)],
      ),
    ]);
    const latest = new Map(latestRows.map((row) => [row.project_name, toPoint(row)]));
    const recent = new Map<string, SamplePoint[]>();
    for (const row of recentRows) {
      const list = recent.get(row.project_name) ?? [];
      list.push(toPoint(row));
      recent.set(row.project_name, list);
    }
    return projects.map((project) => {
      const metrics = deriveMetrics(recent.get(project.name) ?? [], now);
      const last = latest.get(project.name);
      return {
        name: project.name,
        title: project.title,
        description: project.description,
        logo: project.logo,
        leaderboard: project.leaderboard,
        repository: project.repository,
        tracker: project.tracker,
        isAuto: project.isAuto,
        listed: project.listed,
        active: project.active,
        deadline: project.deadline?.toISOString() ?? null,
        firstSeenAt: project.firstSeenAt.toISOString(),
        lastSeenAt: project.lastSeenAt.toISOString(),
        lastSampledAt: project.lastSampledAt?.toISOString() ?? null,
        lastError: project.lastError,
        lastErrorAt: project.lastErrorAt?.toISOString() ?? null,
        latest: last ? toSample(last) : null,
        ...metrics,
      };
    });
  }
}

function toPoint(row: StatRow): SamplePoint {
  return {
    at: new Date(row.sampled_at).getTime(),
    todo: Number(row.todo),
    out: Number(row.out),
    done: Number(row.done),
    downloaderCount: Number(row.downloader_count),
  };
}

function toSample(point: SamplePoint): ProjectSample {
  return {
    sampledAt: new Date(point.at).toISOString(),
    todo: point.todo,
    out: point.out,
    done: point.done,
    downloaderCount: point.downloaderCount,
  };
}
