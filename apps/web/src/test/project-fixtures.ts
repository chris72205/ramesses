import { createSnapshot, type ProjectSummary, type WarriorSnapshot } from '@ramesses/shared';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

/** A summary with sensible defaults; override what a test cares about. */
export function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    name: 'blogger',
    title: 'Blogger',
    description: 'Saving blogs.',
    logo: 'https://example.test/blogger.png',
    leaderboard: 'https://tracker.archiveteam.org/blogger/',
    repository: 'https://github.com/ArchiveTeam/blogger-grab',
    tracker: 'universal',
    isAuto: false,
    listed: true,
    active: true,
    deadline: null,
    firstSeenAt: iso(60 * 24 * 10),
    lastSeenAt: iso(5),
    lastSampledAt: iso(5),
    lastError: null,
    lastErrorAt: null,
    latest: {
      sampledAt: iso(5),
      todo: 340,
      out: 1_283_394,
      done: 28_054_009_556,
      downloaderCount: 1499,
    },
    doneRate: { h1: 437_000, h6: 440_000, h24: 450_000 },
    todo24h: { min: 3, median: 14, max: 8_000, availability: 1, samples: 96 },
    health: 'healthy',
    trend: Array.from({ length: 6 }, (_, i) => ({
      at: iso(90 - i * 15),
      perHour: 400_000 + i * 10_000,
    })),
    ...overrides,
  };
}

export const FIXTURE_NOW = NOW;

export const catalog: ProjectSummary[] = [
  summary(),
  summary({
    name: 'telegram',
    title: 'Telegram',
    isAuto: true,
    latest: {
      sampledAt: iso(5),
      todo: 16_537_395,
      out: 20_000_014,
      done: 50_130_635_318,
      downloaderCount: 11_760,
    },
    doneRate: { h1: 0, h6: 0, h24: 0 },
    todo24h: { min: 16_000_000, median: 16_500_000, max: 17_000_000, availability: 1, samples: 96 },
    health: 'backlog',
    deadline: new Date(NOW + 3 * 86_400_000 + 4 * 3_600_000).toISOString(),
  }),
  summary({
    name: 'urlteam2',
    title: 'URLTeam 2',
    tracker: 'terroroftinytown',
    leaderboard: 'https://tracker.archiveteam.org:1338/',
    latest: null,
    doneRate: { h1: null, h6: null, h24: null },
    todo24h: null,
    health: 'unknown',
    trend: [],
    lastSampledAt: null,
  }),
  summary({
    name: 'pastebin',
    title: 'Pastebin',
    latest: { sampledAt: iso(5), todo: 0, out: 12, done: 900_000, downloaderCount: 40 },
    doneRate: { h1: null, h6: 12, h24: 30 },
    todo24h: { min: 0, median: 0, max: 0, availability: 0, samples: 96 },
    health: 'drained',
    lastError: 'HTTP 503',
    lastErrorAt: iso(20),
  }),
  summary({
    name: 'oldproject',
    title: 'Old Project',
    active: false,
    listed: true,
    latest: null,
    doneRate: { h1: null, h6: null, h24: null },
    todo24h: null,
    health: 'unknown',
    trend: [],
  }),
];

/** A connected warrior working on `project` (a catalog key), for the fleet store in page tests. */
export function warriorOn(id: string, project: string, name = id): WarriorSnapshot {
  const snapshot = createSnapshot({ id, name, host: 'h', port: 8001, enabled: true }, NOW);
  snapshot.connection.state = 'connected';
  snapshot.status = 'RUNNING_PROJECT';
  snapshot.project = {
    title: project,
    name: project,
    logo: null,
    leaderboard: null,
    deadline: null,
  };
  return snapshot;
}
