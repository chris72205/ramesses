/**
 * Pure reducer shared by the backend collector and the browser store, so both sides turn the
 * same warrior events into the same snapshot.
 */
import type { WarriorRecord } from './protocol.js';
import type { BandwidthSample, ItemSnapshot, ProjectInfo, WarriorSnapshot } from './snapshot.js';
import type { WarriorCatalogProject, WarriorEvent, WarriorItem } from './warrior-events.js';

export const LOG_TAIL_LINES = 40;
/**
 * Upper bound on the tail's length in characters. Lines are often long URLs, so the line cap alone
 * lets a tail grow to tens of kilobytes; every tail also rides along in the `/ws` hello.
 */
export const LOG_TAIL_CHARS = 8_192;
export const BANDWIDTH_HISTORY = 90;
/** Finished items linger this long before being dropped, like the stock UI. */
export const FINISHED_ITEM_TTL_MS = 15_000;
/**
 * A connected warrior that has sent nothing for this long is shown as quiet: its IO loop is busy
 * (some project tasks block it for half a minute), which is not the same as a dead socket.
 */
export const QUIET_AFTER_MS = 10_000;

export function createSnapshot(
  record: Pick<WarriorRecord, 'id' | 'name' | 'host' | 'port' | 'enabled'>,
  now: number,
): WarriorSnapshot {
  return {
    id: record.id,
    name: record.name,
    host: record.host,
    port: record.port,
    enabled: record.enabled,
    connection: {
      state: 'connecting',
      lastSeenAt: null,
      connectedAt: null,
      lastError: null,
      attempts: 0,
    },
    instanceId: null,
    status: null,
    runnerStatus: null,
    project: null,
    items: [],
    bandwidth: null,
    bandwidthHistory: [],
    counters: { completed: 0, failed: 0, canceled: 0 },
    broadcastMessage: null,
    catalog: {},
    rolling: null,
    updatedAt: now,
  };
}

/** Reset the parts of a snapshot that a fresh connection will re-send. */
export function resetLiveState(snapshot: WarriorSnapshot, now: number): void {
  snapshot.instanceId = null;
  snapshot.items = [];
  snapshot.bandwidth = null;
  snapshot.updatedAt = now;
}

/**
 * Apply one warrior event to a snapshot in place. Returns true when something changed
 * that the UI should see.
 */
export function applyEvent(snapshot: WarriorSnapshot, event: WarriorEvent, now: number): boolean {
  snapshot.connection.lastSeenAt = now;
  switch (event.event_name) {
    case 'instance_id': {
      const previous = snapshot.instanceId;
      snapshot.instanceId = event.message;
      if (previous && previous !== event.message) {
        // The warrior process restarted; its item ids are no longer meaningful.
        snapshot.items = [];
      }
      return touch(snapshot, now);
    }
    case 'project.refresh': {
      const msg = event.message;
      if (!msg) return false;
      snapshot.runnerStatus = msg.status;
      snapshot.project = msg.project
        ? resolveProject(
            msg.project.title,
            msg.project.project_html,
            msg.project.utc_deadline,
            snapshot.catalog,
            snapshot.project,
          )
        : null;
      // The warrior lists its items only in the refresh it sends on connect. The refresh it
      // broadcasts on a project change always carries an empty list, while items from the previous
      // pipeline keep running until they finish on their own, so an empty list mid-session must
      // not forget them: they still report their task status and completion.
      const running = snapshot.items.filter((item) => item.status === 'running');
      snapshot.items =
        msg.items.length === 0 && running.length > 0
          ? running
          : msg.items.map((item) => toItemSnapshot(item, now));
      return touch(snapshot, now);
    }
    case 'warrior.projects_loaded': {
      snapshot.catalog = {};
      for (const [name, project] of Object.entries(event.message.projects)) {
        snapshot.catalog[name] = { ...project, name: project.name ?? name };
      }
      if (snapshot.project) {
        snapshot.project = resolveProject(
          snapshot.project.title,
          null,
          snapshot.project.deadline,
          snapshot.catalog,
          snapshot.project,
        );
      }
      return touch(snapshot, now);
    }
    case 'warrior.status':
      snapshot.status = event.message.status;
      if (event.message.status === 'NO_PROJECT') {
        snapshot.project = null;
        snapshot.items = [];
      }
      return touch(snapshot, now);
    case 'runner.status':
      snapshot.runnerStatus = event.message.status;
      return touch(snapshot, now);
    case 'warrior.broadcast_message':
      snapshot.broadcastMessage = event.message.message;
      return touch(snapshot, now);
    case 'warrior.project_selected':
    case 'warrior.project_installing':
    case 'warrior.project_installed': {
      // `project_selected` carries the catalog key itself; the install events carry the entry.
      const project = event.message?.project;
      const name = typeof project === 'string' ? project : project?.name;
      const catalogEntry = name ? snapshot.catalog[name] : undefined;
      if (catalogEntry) {
        snapshot.project = catalogToProject(catalogEntry, snapshot.project?.deadline ?? null);
        return touch(snapshot, now);
      }
      return false;
    }
    case 'pipeline.start_item': {
      const item = toItemSnapshot(event.message.item, now);
      snapshot.items = [...snapshot.items.filter((i) => i.id !== item.id), item];
      return touch(snapshot, now);
    }
    case 'item.output': {
      const item = findItem(snapshot, event.message.item_id);
      if (!item) return false;
      appendLog(item, event.message.data);
      return touch(snapshot, now);
    }
    case 'item.task_status': {
      const item = findItem(snapshot, event.message.item_id);
      if (!item) return false;
      const task = item.tasks.find((t) => t.id === event.message.task_id);
      if (!task) return false;
      task.status = event.message.new_status;
      return touch(snapshot, now);
    }
    case 'item.update_name': {
      const item = findItem(snapshot, event.message.item_id);
      if (!item) return false;
      item.name = event.message.new_name;
      return touch(snapshot, now);
    }
    case 'item.complete':
    case 'item.fail':
    case 'item.cancel': {
      const item = findItem(snapshot, event.message.item_id);
      const status =
        event.event_name === 'item.complete'
          ? 'completed'
          : event.event_name === 'item.fail'
            ? 'failed'
            : 'canceled';
      snapshot.counters[status] += 1;
      if (item) {
        item.status = status;
        item.finishedAt = now;
      }
      return touch(snapshot, now);
    }
    case 'bandwidth': {
      const sample: BandwidthSample = {
        at: now,
        received: event.message.received,
        sent: event.message.sent,
        receiving: event.message.receiving,
        sending: event.message.sending,
      };
      snapshot.bandwidth = sample;
      snapshot.bandwidthHistory.push(sample);
      if (snapshot.bandwidthHistory.length > BANDWIDTH_HISTORY) {
        snapshot.bandwidthHistory.splice(0, snapshot.bandwidthHistory.length - BANDWIDTH_HISTORY);
      }
      return touch(snapshot, now);
    }
    case 'timestamp':
    case 'warrior.settings_update':
    case 'warrior.project_installation_failed':
      return false;
    default:
      return false;
  }
}

/** Drop finished items older than the TTL. Returns true when something was removed. */
export function pruneFinishedItems(snapshot: WarriorSnapshot, now: number): boolean {
  const before = snapshot.items.length;
  snapshot.items = snapshot.items.filter(
    (item) => item.finishedAt === null || now - item.finishedAt < FINISHED_ITEM_TTL_MS,
  );
  if (snapshot.items.length !== before) return touch(snapshot, now);
  return false;
}

function touch(snapshot: WarriorSnapshot, now: number): true {
  snapshot.updatedAt = now;
  return true;
}

function findItem(snapshot: WarriorSnapshot, id: string): ItemSnapshot | undefined {
  return snapshot.items.find((item) => item.id === id);
}

function toItemSnapshot(item: WarriorItem, now: number): ItemSnapshot {
  const terminal = item.status !== 'running';
  const snapshot: ItemSnapshot = {
    id: item.id,
    number: item.number,
    name: item.name,
    status: item.status,
    tasks: item.tasks.map((t) => ({ id: t.id, name: t.name, status: t.status })),
    logTail: '',
    startTime: item.start_time,
    finishedAt: terminal ? now : null,
  };
  if (item.output) appendLog(snapshot, item.output);
  return snapshot;
}

/** Mirrors the stock UI: a carriage return without a newline overwrites the line. */
export function stripCarriageReturns(text: string): string {
  return text.replace(/[^\n]*\r(?!\n|$)/g, '');
}

function appendLog(item: ItemSnapshot, data: string): void {
  const cleaned = stripCarriageReturns(data).replace(/\r\n/g, '\n');
  if (!cleaned) return;
  item.logTail = tailLines(item.logTail + cleaned, LOG_TAIL_LINES, LOG_TAIL_CHARS);
}

/**
 * Keep only the last `maxLines` lines of `text`, and no more than `maxChars` characters. A trailing
 * newline ends a line, so the empty remainder after it counts as one, like a `split('\n')` would.
 *
 * Output arrives in many small chunks per second for every running item, so this scans for
 * newlines from the end and takes one slice instead of splitting the whole tail into an array and
 * joining it back on every chunk.
 */
export function tailLines(text: string, maxLines: number, maxChars = Infinity): string {
  let newlines = 0;
  let position = text.length;
  while (newlines < maxLines && position > 0) {
    const index = text.lastIndexOf('\n', position - 1);
    if (index === -1) break;
    newlines += 1;
    position = index;
  }
  let start = newlines === maxLines ? position + 1 : 0;
  if (text.length - start > maxChars) {
    // Start at a line boundary: a cut that lands mid-line drops the rest of that line, unless it
    // is the only line left.
    const cut = text.length - maxChars;
    const lineEnd = text.indexOf('\n', cut);
    const onBoundary = text.charCodeAt(cut - 1) === 10;
    start = onBoundary || lineEnd === -1 || lineEnd === text.length - 1 ? cut : lineEnd + 1;
  }
  return start === 0 ? text : text.slice(start);
}

function resolveProject(
  title: string,
  projectHtml: string | null,
  deadline: string | null,
  catalog: Record<string, WarriorCatalogProject>,
  previous: ProjectInfo | null,
): ProjectInfo {
  const lowered = title.toLowerCase();
  const match = Object.values(catalog).find(
    (p) => p.title.toLowerCase() === lowered || p.name.toLowerCase() === lowered,
  );
  if (match) return catalogToProject(match, deadline);
  const logoFromHtml = projectHtml
    ? (/<img[^>]*src="([^"]+)"/.exec(projectHtml)?.[1] ?? null)
    : null;
  const leaderboardFromHtml = projectHtml
    ? (/<a href="([^"]+)">Leaderboard<\/a>/.exec(projectHtml)?.[1] ?? null)
    : null;
  return {
    title,
    name: previous?.title === title ? previous.name : null,
    logo: logoFromHtml ?? (previous?.title === title ? previous.logo : null),
    leaderboard: leaderboardFromHtml ?? (previous?.title === title ? previous.leaderboard : null),
    deadline,
  };
}

function catalogToProject(entry: WarriorCatalogProject, deadline: string | null): ProjectInfo {
  return {
    title: entry.title,
    name: entry.name,
    logo: entry.logo || null,
    leaderboard: entry.leaderboard || null,
    deadline,
  };
}
