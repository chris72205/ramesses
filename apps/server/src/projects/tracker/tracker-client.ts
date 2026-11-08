import { z } from 'zod';

/** The catalog as the sampler needs it, normalized from `projects.json`. */
export interface TrackerCatalog {
  /** "ArchiveTeam's Choice", when the tracker names one */
  autoProject: string | null;
  projects: TrackerCatalogProject[];
}

export interface TrackerCatalogProject {
  name: string;
  title: string;
  description: string;
  logo: string | null;
  leaderboard: string | null;
  repository: string | null;
  /** ISO 8601 as sent by the tracker, unparsed */
  deadline: string | null;
}

/** The numbers the sampler keeps from `stats.json`. */
export interface TrackerStats {
  todo: number;
  out: number;
  done: number;
  rcr: number | null;
  downloaderCount: number;
}

export interface TrackerClient {
  fetchCatalog(): Promise<TrackerCatalog>;
  fetchStats(name: string): Promise<TrackerStats>;
}

export const TRACKER_CLIENT = Symbol('TRACKER_CLIENT');

const optionalText = z.string().nullish();

/** Only the fields the sampler reads are validated; the tracker may add others at any time. */
export const catalogSchema = z.looseObject({
  auto_project: optionalText,
  projects: z.array(
    z.looseObject({
      name: z.string().min(1),
      title: z.string().min(1),
      description: optionalText,
      logo: optionalText,
      leaderboard: optionalText,
      repository: optionalText,
      deadline: optionalText,
    }),
  ),
});

export const statsSchema = z.looseObject({
  counts: z.looseObject({
    todo: z.number().nonnegative(),
    out: z.number().nonnegative(),
    done: z.number().nonnegative(),
    rcr: z.number().nullish(),
  }),
  downloaders: z.array(z.string()).nullish(),
});

export class TrackerError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

export interface HttpTrackerClientOptions {
  projectsUrl: string;
  /** `{name}` is replaced by the project slug */
  statsUrlTemplate: string;
  userAgent?: string;
  timeoutMs?: number;
  /** delay before the single retry on a network error or a 5xx */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export const DEFAULT_USER_AGENT = 'ramesses/0.1.0 (+https://github.com/chris72205/ramesses)';

/**
 * Plain HTTPS client for the universal tracker. One request per call, a descriptive
 * User-Agent, gzip, a timeout, and one retry on transient failures. Never called by browsers.
 */
export class HttpTrackerClient implements TrackerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(private readonly options: HttpTrackerClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  public async fetchCatalog(): Promise<TrackerCatalog> {
    const body = await this.getJson(this.options.projectsUrl);
    const parsed = catalogSchema.safeParse(body);
    if (!parsed.success) {
      throw new TrackerError(`catalog has an unexpected shape`, this.options.projectsUrl);
    }
    return {
      autoProject: parsed.data.auto_project ?? null,
      projects: parsed.data.projects.map((p) => ({
        name: p.name,
        title: p.title,
        description: p.description ?? '',
        logo: p.logo ?? null,
        leaderboard: p.leaderboard ?? null,
        repository: p.repository ?? null,
        deadline: p.deadline ?? null,
      })),
    };
  }

  public async fetchStats(name: string): Promise<TrackerStats> {
    const url = this.options.statsUrlTemplate.replace('{name}', encodeURIComponent(name));
    const body = await this.getJson(url);
    const parsed = statsSchema.safeParse(body);
    if (!parsed.success) throw new TrackerError(`stats have an unexpected shape`, url);
    const { counts, downloaders } = parsed.data;
    return {
      todo: counts.todo,
      out: counts.out,
      done: counts.done,
      rcr: counts.rcr ?? null,
      downloaderCount: downloaders?.length ?? 0,
    };
  }

  private async getJson(url: string): Promise<unknown> {
    try {
      return await this.getOnce(url);
    } catch (error) {
      if (error instanceof TrackerError && error.status !== undefined && error.status < 500) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      return this.getOnce(url);
    }
  }

  private async getOnce(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { 'user-agent': this.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TrackerError(error instanceof Error ? error.message : String(error), url);
    }
    if (!response.ok) {
      throw new TrackerError(`HTTP ${response.status}`, url, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new TrackerError('response is not JSON', url, response.status);
    }
  }
}
