import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { FleetTotals, ServerMessage, TimedEvent, WarriorSnapshot } from '@ramesses/shared';
import { MetricsService } from '../metrics/metrics.service';
import type { Warrior } from '../warriors/warrior.entity';
import { WarriorsService, type WarriorChange } from '../warriors/warriors.service';
import { METRICS_SINK, type MetricsSink } from './metrics-sink';
import {
  WarriorConnection,
  type WarriorConnectionOptions,
  type WarriorUpdate,
} from './warrior-connection';

/** Pushes per warrior are coalesced to this window. */
export const PUSH_COALESCE_MS = 250;
/** Fleet totals are recomputed and pushed at most this often. */
export const FLEET_PUSH_MS = 1_000;
/** Rolling-window aggregates are re-read from Redis this often. */
export const ROLLING_REFRESH_MS = 2_000;

export type FleetListener = (message: ServerMessage) => void;

/** Optional provider: builds a WarriorConnection. Tests inject a fake. */
export const WARRIOR_CONNECTION_FACTORY = Symbol('WARRIOR_CONNECTION_FACTORY');
export type WarriorConnectionFactory = (options: WarriorConnectionOptions) => WarriorConnection;

/** Updates accumulated for one warrior until its coalescing timer fires. */
interface PendingPush {
  timer: NodeJS.Timeout;
  /** a full snapshot is due; it subsumes everything else collected in this window */
  snapshot: boolean;
  connection: boolean;
  events: TimedEvent[];
}

@Injectable()
export class FleetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FleetService.name);
  private readonly connections = new Map<string, WarriorConnection>();
  private readonly listeners = new Set<FleetListener>();
  private readonly pending = new Map<string, PendingPush>();
  private fleetPushTimer: NodeJS.Timeout | null = null;
  private rollingTimer: NodeJS.Timeout | null = null;
  private changes: Subscription | null = null;
  private readonly createConnection: WarriorConnectionFactory;

  constructor(
    private readonly warriors: WarriorsService,
    private readonly metricsService: MetricsService,
    @Inject(METRICS_SINK) private readonly metrics: MetricsSink,
    @Optional() @Inject(WARRIOR_CONNECTION_FACTORY) createConnection?: WarriorConnectionFactory,
  ) {
    this.createConnection = createConnection ?? ((options) => new WarriorConnection(options));
  }

  async onModuleInit(): Promise<void> {
    const all = await this.warriors.findAll();
    for (const warrior of all) this.upsert(warrior);
    this.changes = this.warriors.changes$.subscribe((change) => this.onWarriorChange(change));
    this.rollingTimer = setInterval(() => void this.refreshRolling(), ROLLING_REFRESH_MS);
    this.logger.log(`Tracking ${all.length} warrior(s)`);
  }

  onModuleDestroy(): void {
    this.changes?.unsubscribe();
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    if (this.fleetPushTimer) clearTimeout(this.fleetPushTimer);
    this.fleetPushTimer = null;
    if (this.rollingTimer) clearInterval(this.rollingTimer);
    this.rollingTimer = null;
    for (const connection of this.connections.values()) connection.stop();
    this.connections.clear();
  }

  snapshots(): WarriorSnapshot[] {
    return [...this.connections.values()].map((c) => c.snapshot);
  }

  totals(): FleetTotals {
    const snapshots = this.snapshots();
    const projects = new Set<string>();
    const totals: FleetTotals = {
      warriors: snapshots.length,
      enabled: 0,
      connected: 0,
      receiving: 0,
      sending: 0,
      received: 0,
      sent: 0,
      itemsInFlight: 0,
      completed: 0,
      failed: 0,
      projects: [],
      rollingWindowMs: this.metricsService.windowMs,
      avgReceiving: 0,
      avgSending: 0,
    };
    for (const s of snapshots) {
      if (s.enabled) totals.enabled += 1;
      if (s.connection.state === 'connected') {
        totals.connected += 1;
        if (s.bandwidth) {
          totals.receiving += s.bandwidth.receiving;
          totals.sending += s.bandwidth.sending;
          totals.received += s.bandwidth.received;
          totals.sent += s.bandwidth.sent;
        }
        if (s.rolling) {
          totals.avgReceiving += s.rolling.avgReceiving;
          totals.avgSending += s.rolling.avgSending;
        }
        totals.itemsInFlight += s.items.filter((i) => i.status === 'running').length;
        if (s.project) projects.add(s.project.title);
      }
      totals.completed += s.counters.completed;
      totals.failed += s.counters.failed;
    }
    totals.projects = [...projects].sort();
    return totals;
  }

  /** Register a listener for pushes. Returns an unsubscribe function. */
  subscribe(listener: FleetListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-read trailing-window aggregates for every running warrior. Public for tests. */
  async refreshRolling(): Promise<void> {
    const running = [...this.connections.values()].filter((c) => c.isRunning);
    if (running.length === 0) return;
    const stats = await this.metricsService.windowStatsForMany(running.map((c) => c.id));
    for (const connection of running) {
      const next = stats.get(connection.id) ?? null;
      const previous = connection.snapshot.rolling;
      if (!next && !previous) continue;
      connection.snapshot.rolling = next;
      this.broadcast({ type: 'warrior_rolling', id: connection.id, rolling: next });
    }
    this.scheduleFleetPush();
  }

  private onWarriorChange(change: WarriorChange): void {
    switch (change.type) {
      case 'created':
      case 'updated':
        this.upsert(change.warrior);
        break;
      case 'removed':
        this.remove(change.id);
        break;
    }
  }

  private upsert(warrior: Warrior): void {
    const existing = this.connections.get(warrior.id);
    if (existing) {
      const s = existing.snapshot;
      const needsReconnect =
        s.host !== warrior.host || s.port !== warrior.port || s.enabled !== warrior.enabled;
      if (!needsReconnect) {
        existing.rename(warrior.name);
        return;
      }
      existing.stop();
      existing.removeAllListeners();
      this.connections.delete(warrior.id);
    }
    const connection = this.createConnection({
      record: warrior,
      metrics: this.metrics,
      log: (level, message) =>
        this.logger[level === 'warn' ? 'warn' : level === 'info' ? 'log' : 'debug'](message),
    });
    connection.on('update', (update) => this.onUpdate(warrior.id, update));
    this.connections.set(warrior.id, connection);
    if (warrior.enabled) connection.start();
    this.schedulePush(warrior.id, { kind: 'snapshot' });
  }

  private remove(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    connection.stop();
    connection.removeAllListeners();
    this.connections.delete(id);
    const pending = this.pending.get(id);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(id);
    void this.metricsService.forget(id);
    this.broadcast({ type: 'warrior_removed', id });
    this.scheduleFleetPush();
  }

  private onUpdate(id: string, update: WarriorUpdate): void {
    // Clients drop finished items on their own clock; only the totals need a refresh.
    if (update.kind === 'pruned') this.scheduleFleetPush();
    else this.schedulePush(id, update);
  }

  /** Collect updates for one warrior and flush the smallest message set after the window. */
  private schedulePush(id: string, update: Exclude<WarriorUpdate, { kind: 'pruned' }>): void {
    let pending = this.pending.get(id);
    if (!pending) {
      pending = {
        timer: setTimeout(() => this.flush(id), PUSH_COALESCE_MS),
        snapshot: false,
        connection: false,
        events: [],
      };
      this.pending.set(id, pending);
    }
    switch (update.kind) {
      case 'snapshot':
        pending.snapshot = true;
        break;
      case 'connection':
        pending.connection = true;
        break;
      case 'event':
        pending.events.push(update.event);
        break;
    }
  }

  private flush(id: string): void {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    const connection = this.connections.get(id);
    if (pending && connection) {
      if (pending.snapshot) {
        this.broadcast({ type: 'warrior', warrior: connection.snapshot });
      } else {
        if (pending.connection) {
          this.broadcast({
            type: 'warrior_connection',
            id,
            connection: connection.snapshot.connection,
          });
        }
        if (pending.events.length > 0) {
          this.broadcast({ type: 'warrior_events', id, events: pending.events });
        }
      }
    }
    this.scheduleFleetPush();
  }

  private scheduleFleetPush(): void {
    if (this.fleetPushTimer) return;
    this.fleetPushTimer = setTimeout(() => {
      this.fleetPushTimer = null;
      this.broadcast({ type: 'fleet', fleet: this.totals() });
    }, FLEET_PUSH_MS);
  }

  private broadcast(message: ServerMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (error) {
        this.logger.warn(
          `listener failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
