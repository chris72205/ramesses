import type { ProjectSummary, QueueHealth, TrackerKind } from '@ramesses/shared';

/**
 * Filter and sort state of the Projects index, kept in the URL query so links and reloads
 * reproduce the same view. Everything here is pure: the page parses the query, renders from
 * it, and writes the next query back when a control changes.
 */

export const HEALTH_VALUES: readonly QueueHealth[] = [
  'backlog',
  'healthy',
  'intermittent',
  'drained',
  'unknown',
];
export const HEALTH_LABELS: Record<QueueHealth, string> = {
  backlog: 'Backlog',
  healthy: 'Healthy',
  intermittent: 'Intermittent',
  drained: 'Drained',
  unknown: 'Unknown',
};
/** Sort order of the Queue column: the most work available ranks highest. */
const HEALTH_RANK: Record<QueueHealth, number> = {
  backlog: 4,
  healthy: 3,
  intermittent: 2,
  drained: 1,
  unknown: 0,
};

export const TRACKER_VALUES: readonly TrackerKind[] = ['universal', 'terroroftinytown', 'unknown'];
export const TRACKER_LABELS: Record<TrackerKind, string> = {
  universal: 'Universal tracker',
  terroroftinytown: 'URLTeam',
  unknown: 'Unknown tracker',
};

/** Whether any of your warriors is on the project right now. */
export type MineFilter = 'any' | 'running' | 'idle';
export const MINE_VALUES: readonly MineFilter[] = ['any', 'running', 'idle'];
export const MINE_LABELS: Record<MineFilter, string> = {
  any: 'Any warriors',
  running: 'Running on my warriors',
  idle: 'Not running on my warriors',
};

export interface ProjectFilters {
  /** case-insensitive substring of the project's name or title; trimmed when matched */
  query: string;
  /** queue-health labels to keep; empty keeps every label */
  health: QueueHealth[];
  /** tracker kind to keep; null keeps every kind */
  tracker: TrackerKind | null;
  mine: MineFilter;
  /** keep only projects whose maintainers set a deadline */
  deadline: boolean;
  /** keep only the tracker's "ArchiveTeam's Choice" */
  choice: boolean;
  /** include unlisted and retired projects */
  hidden: boolean;
}

export const DEFAULT_FILTERS: ProjectFilters = {
  query: '',
  health: [],
  tracker: null,
  mine: 'any',
  deadline: false,
  choice: false,
  hidden: false,
};

export type SortKey =
  'title' | 'warriors' | 'health' | 'todo' | 'out' | 'h1' | 'h24' | 'deadline' | 'sampled';
export const SORT_KEYS: readonly SortKey[] = [
  'title',
  'warriors',
  'health',
  'todo',
  'out',
  'h1',
  'h24',
  'deadline',
  'sampled',
];
export type SortDir = 'asc' | 'desc';

export interface ProjectSort {
  key: SortKey;
  dir: SortDir;
}

/** The direction a column starts in when it is first chosen: names and dates read upward. */
export function defaultSortDir(key: SortKey): SortDir {
  return key === 'title' || key === 'deadline' ? 'asc' : 'desc';
}

export const DEFAULT_SORT: ProjectSort = { key: 'h24', dir: defaultSortDir('h24') };

export interface ProjectsQuery {
  filters: ProjectFilters;
  sort: ProjectSort;
}

/** Query keys this view owns; anything else in the URL is left alone. */
export const QUERY_KEYS = [
  'q',
  'health',
  'tracker',
  'mine',
  'deadline',
  'choice',
  'hidden',
  'sort',
  'dir',
] as const;

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | null {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** Read the view state out of a URL query. Unknown or malformed values fall back to defaults. */
export function parseProjectsQuery(params: URLSearchParams): ProjectsQuery {
  const health = (params.get('health') ?? '')
    .split(',')
    .map((value) => oneOf(HEALTH_VALUES, value))
    .filter((value): value is QueueHealth => value !== null);
  const key = oneOf(SORT_KEYS, params.get('sort')) ?? DEFAULT_SORT.key;
  const dir = oneOf<SortDir>(['asc', 'desc'], params.get('dir')) ?? defaultSortDir(key);
  return {
    filters: {
      query: params.get('q') ?? '',
      health: HEALTH_VALUES.filter((value) => health.includes(value)),
      tracker: oneOf(TRACKER_VALUES, params.get('tracker')),
      mine: oneOf(MINE_VALUES, params.get('mine')) ?? 'any',
      deadline: params.get('deadline') === '1',
      choice: params.get('choice') === '1',
      hidden: params.get('hidden') === '1',
    },
    sort: { key, dir },
  };
}

/** Write the view state as a URL query, leaving out everything at its default so `/projects` stays bare. */
export function serializeProjectsQuery({ filters, sort }: ProjectsQuery): URLSearchParams {
  const params = new URLSearchParams();
  // Kept as typed, spaces included, so the search box never fights the cursor mid-word.
  if (filters.query) params.set('q', filters.query);
  if (filters.health.length > 0 && filters.health.length < HEALTH_VALUES.length) {
    params.set('health', HEALTH_VALUES.filter((value) => filters.health.includes(value)).join(','));
  }
  if (filters.tracker) params.set('tracker', filters.tracker);
  if (filters.mine !== 'any') params.set('mine', filters.mine);
  if (filters.deadline) params.set('deadline', '1');
  if (filters.choice) params.set('choice', '1');
  if (filters.hidden) params.set('hidden', '1');
  if (sort.key !== DEFAULT_SORT.key) params.set('sort', sort.key);
  if (sort.dir !== defaultSortDir(sort.key)) params.set('dir', sort.dir);
  return params;
}

/** True when every filter, including "show hidden", is at its default. */
export function isDefaultFilters(filters: ProjectFilters): boolean {
  return describeFilters(filters).length === 0 && !filters.hidden;
}

/**
 * The filters that narrow the list, in words, for the empty state. "Show hidden" widens the
 * list rather than narrowing it, so it is not listed here.
 */
export function describeFilters(filters: ProjectFilters): string[] {
  const parts: string[] = [];
  if (filters.query.trim()) parts.push(`search "${filters.query.trim()}"`);
  if (filters.health.length > 0 && filters.health.length < HEALTH_VALUES.length) {
    parts.push(
      `queue ${HEALTH_VALUES.filter((value) => filters.health.includes(value))
        .map((value) => HEALTH_LABELS[value].toLowerCase())
        .join(' or ')}`,
    );
  }
  if (filters.tracker) parts.push(TRACKER_LABELS[filters.tracker].toLowerCase());
  if (filters.mine === 'running') parts.push('running on your warriors');
  if (filters.mine === 'idle') parts.push('not running on your warriors');
  if (filters.deadline) parts.push('has a deadline');
  if (filters.choice) parts.push("ArchiveTeam's Choice");
  return parts;
}

/**
 * Apply every filter (they combine with AND). `running` holds the catalog names of the projects
 * at least one of your warriors is on, from the fleet join.
 */
export function filterProjects(
  items: readonly ProjectSummary[],
  filters: ProjectFilters,
  running: ReadonlySet<string>,
): ProjectSummary[] {
  const needle = filters.query.trim().toLowerCase();
  return items.filter((project) => {
    if (!filters.hidden && !(project.listed && project.active)) return false;
    if (
      needle &&
      !project.name.toLowerCase().includes(needle) &&
      !project.title.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (filters.health.length > 0 && !filters.health.includes(project.health)) return false;
    if (filters.tracker && project.tracker !== filters.tracker) return false;
    if (filters.mine === 'running' && !running.has(project.name)) return false;
    if (filters.mine === 'idle' && running.has(project.name)) return false;
    if (filters.deadline && !project.deadline) return false;
    if (filters.choice && !project.isAuto) return false;
    return true;
  });
}

function sortValue(
  project: ProjectSummary,
  key: SortKey,
  warriorCount: (name: string) => number,
): number | string | null {
  switch (key) {
    case 'title':
      return project.title.toLowerCase();
    case 'warriors':
      return warriorCount(project.name);
    case 'health':
      return HEALTH_RANK[project.health];
    case 'todo':
      return project.latest?.todo ?? null;
    case 'out':
      return project.latest?.out ?? null;
    case 'h1':
      return project.doneRate.h1;
    case 'h24':
      return project.doneRate.h24;
    case 'deadline':
      return project.deadline ? Date.parse(project.deadline) : null;
    case 'sampled':
      return project.lastSampledAt ? Date.parse(project.lastSampledAt) : null;
  }
}

/** Sort a copy of the list. Missing values sink to the bottom whichever way the column is sorted. */
export function sortProjects(
  items: readonly ProjectSummary[],
  sort: ProjectSort,
  warriorCount: (name: string) => number,
): ProjectSummary[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = sortValue(a, sort.key, warriorCount);
    const vb = sortValue(b, sort.key, warriorCount);
    if (va === null && vb === null) return a.title.localeCompare(b.title);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.title.localeCompare(b.title);
  });
}
