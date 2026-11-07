import type { ConnectionInfo, FleetTotals, RollingStats, WarriorSnapshot } from './snapshot.js';
import type { WarriorEvent } from './warrior-events.js';

/** A warrior event plus the server clock when it was applied; replay with `applyEvent(_, event, at)`. */
export interface TimedEvent {
  at: number;
  event: WarriorEvent;
}

/**
 * Messages the backend pushes to browser clients over /ws.
 *
 * `hello` carries everything the display needs (full snapshots with recent bandwidth history and
 * rolling averages, plus fleet totals). After that the server sends only what changed:
 * `warrior_events` batches are the warrior's own events since the previous message, applied on the
 * client with the shared reducer. A full `warrior` snapshot is sent only to resync one warrior
 * (connection open, `project.refresh`, start/stop/rename).
 */
export type ServerMessage =
  | { type: 'hello'; warriors: WarriorSnapshot[]; fleet: FleetTotals }
  | { type: 'warrior'; warrior: WarriorSnapshot }
  | { type: 'warrior_events'; id: string; events: TimedEvent[] }
  | { type: 'warrior_connection'; id: string; connection: ConnectionInfo }
  | { type: 'warrior_rolling'; id: string; rolling: RollingStats | null }
  | { type: 'warrior_removed'; id: string }
  | { type: 'fleet'; fleet: FleetTotals };

/** Row shape returned by the warriors REST API. */
export interface WarriorRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWarriorInput {
  host: string;
  port?: number;
  name?: string;
}

export interface UpdateWarriorInput {
  name?: string;
  port?: number;
  enabled?: boolean;
}
