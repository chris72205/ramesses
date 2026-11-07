import type {
  ItemStatus,
  RunnerStatus,
  TaskStatus,
  WarriorCatalogProject,
  WarriorStatus,
} from './warrior-events.js';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ConnectionInfo {
  state: ConnectionState;
  /** ms since epoch of the last message received from the warrior */
  lastSeenAt: number | null;
  /** ms since epoch of the last successful open */
  connectedAt: number | null;
  lastError: string | null;
  attempts: number;
}

export interface TaskSnapshot {
  id: number;
  name: string;
  status: TaskStatus;
}

export interface ItemSnapshot {
  id: string;
  number: number;
  name: string;
  status: ItemStatus;
  tasks: TaskSnapshot[];
  /** tail of the item log, last N lines joined with newlines */
  logTail: string;
  startTime: number;
  /** ms since epoch when the item reached a terminal status */
  finishedAt: number | null;
}

export interface BandwidthSample {
  /** ms since epoch */
  at: number;
  received: number;
  sent: number;
  receiving: number;
  sending: number;
}

export interface ProjectInfo {
  title: string;
  /** catalog key, when it could be resolved from the catalog */
  name: string | null;
  logo: string | null;
  leaderboard: string | null;
  deadline: string | null;
}

/** Aggregates over a trailing time window of bandwidth samples. */
export interface RollingStats {
  windowMs: number;
  samples: number;
  avgReceiving: number;
  avgSending: number;
  peakReceiving: number;
  peakSending: number;
}

export interface WarriorCounters {
  completed: number;
  failed: number;
  canceled: number;
}

export interface WarriorSnapshot {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
  connection: ConnectionInfo;
  instanceId: string | null;
  status: WarriorStatus | null;
  runnerStatus: RunnerStatus | null;
  project: ProjectInfo | null;
  items: ItemSnapshot[];
  bandwidth: BandwidthSample | null;
  /** rolling history of recent bandwidth samples, oldest first */
  bandwidthHistory: BandwidthSample[];
  /** aggregate over the configured rolling window, computed from samples stored in Redis */
  rolling: RollingStats | null;
  counters: WarriorCounters;
  broadcastMessage: string | null;
  catalog: Record<string, WarriorCatalogProject>;
  /** ms since epoch when this snapshot last changed */
  updatedAt: number;
}

export interface FleetTotals {
  warriors: number;
  enabled: number;
  connected: number;
  receiving: number;
  sending: number;
  received: number;
  sent: number;
  itemsInFlight: number;
  completed: number;
  failed: number;
  projects: string[];
  /** sum of connected warriors' rolling averages */
  rollingWindowMs: number;
  avgReceiving: number;
  avgSending: number;
}
