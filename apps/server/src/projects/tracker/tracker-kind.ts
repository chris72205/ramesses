import type { TrackerKind } from '@ramesses/shared';

/** The terroroftinytown (URLTeam) tracker lives on this port of the tracker host. */
const TINYTOWN_PORT = '1338';
const TRACKER_HOST = 'tracker.archiveteam.org';

/**
 * Which tracker serves a project, read from its leaderboard URL. The universal tracker hosts
 * leaderboards at `https://tracker.archiveteam.org/<name>/`; URLTeam's own tracker answers on
 * port 1338 and has no stats endpoint we can poll.
 */
export function trackerKindFor(leaderboard: string | null): TrackerKind {
  if (!leaderboard) return 'unknown';
  let url: URL;
  try {
    url = new URL(leaderboard);
  } catch {
    return 'unknown';
  }
  if (url.hostname !== TRACKER_HOST) return 'unknown';
  if (url.port === TINYTOWN_PORT) return 'terroroftinytown';
  return /^\/[^/]+\/?$/.test(url.pathname) ? 'universal' : 'unknown';
}

/** The tracker writes deadlines as `YYYY-MM-DDTHH:MM:SSZ`; anything unparsable is dropped. */
export function parseDeadline(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
