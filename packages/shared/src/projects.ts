/**
 * Archive Team project catalog and tracker statistics as served by the backend's
 * `/api/projects` endpoints and pushed over `/ws`: the `hello` message carries the current
 * summaries and a `projects` message follows every sample.
 *
 * The tracker reports queue depths, not rates: `todo` is the number of items waiting to be
 * claimed, `out` the number checked out to workers, `done` the number completed. Everything
 * derived (items per hour, queue health) comes from the backend's own samples over time.
 */

/** Which tracker software serves a project's numbers. */
export type TrackerKind =
  /** the universal tracker: `v1.api.tracker.archiveteam.org/<name>/stats.json` */
  | 'universal'
  /** URLTeam's terroroftinytown tracker (WebSocket only; no stats in this version) */
  | 'terroroftinytown'
  | 'unknown';

/**
 * How reliably the project has had work available over the last day, judged from the
 * distribution of `todo` across samples, never from a single reading.
 */
export type QueueHealth =
  /** `todo` was above zero in fewer than a fifth of the samples and never climbed high */
  | 'drained'
  /** work appears in bursts: the queue is refilled in batches */
  | 'intermittent'
  /** work was available in most samples */
  | 'healthy'
  /** healthy, and the queue is deep enough to last a long time */
  | 'backlog'
  /** too few samples to judge */
  | 'unknown';

/** One stored tracker sample. */
export interface ProjectSample {
  /** ISO timestamp of the backend's clock when the sample was fetched */
  sampledAt: string;
  todo: number;
  out: number;
  done: number;
  downloaderCount: number;
}

/** Items completed per hour over trailing windows; null until the window has two samples. */
export interface DoneRates {
  h1: number | null;
  h6: number | null;
  h24: number | null;
}

/** Distribution of `todo` over the trailing 24 hours. */
export interface TodoDistribution {
  min: number;
  median: number;
  max: number;
  /** share of samples (0 to 1) with `todo` above zero */
  availability: number;
  samples: number;
}

/** One point of the trend sparkline: completion rate over the interval ending at `at`. */
export interface TrendPoint {
  at: string;
  perHour: number;
}

/** A catalog entry with its latest numbers and derived metrics. */
export interface ProjectSummary {
  name: string;
  title: string;
  description: string;
  logo: string | null;
  leaderboard: string | null;
  repository: string | null;
  tracker: TrackerKind;
  /** the tracker's "ArchiveTeam's Choice"; shown as recommended, never weighed by Ramesses */
  isAuto: boolean;
  /** has both a logo and a leaderboard, the tracker homepage's own display rule */
  listed: boolean;
  /** present in the latest catalog fetch; retired projects stay stored but inactive */
  active: boolean;
  /** when the project stops accepting work, if its maintainers set one */
  deadline: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSampledAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  latest: ProjectSample | null;
  doneRate: DoneRates;
  todo24h: TodoDistribution | null;
  health: QueueHealth;
  trend: TrendPoint[];
}

/** The detail endpoint returns the same shape; kept distinct so it can grow independently. */
export type ProjectDetail = ProjectSummary;

export type HistoryRange = '24h' | '7d' | '30d';

/** A stored sample plus the completion rate since the previous point. */
export interface HistoryPoint extends ProjectSample {
  donePerHour: number | null;
}

export interface ProjectHistory {
  name: string;
  range: HistoryRange;
  /** `raw` for 24h, `hourly` buckets (last sample per hour) for the longer ranges */
  resolution: 'raw' | 'hourly';
  points: HistoryPoint[];
}

/** Reply to a manual refresh request. */
export interface RefreshResult {
  /** false when the previous run is too recent; see `nextAllowedAt` */
  requested: boolean;
  lastRunAt: string | null;
  nextAllowedAt: string | null;
}
