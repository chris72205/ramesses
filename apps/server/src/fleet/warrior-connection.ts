import { EventEmitter } from 'node:events';
import {
  applyEvent,
  createSnapshot,
  pruneFinishedItems,
  resetLiveState,
  type TimedEvent,
  type WarriorEvent,
  type WarriorRecord,
  type WarriorSnapshot,
} from '@ramesses/shared';
import type { MetricsSink } from './metrics-sink';
import { SockJsClient, sockJsSessionUrl, type SockJsClientLike } from './sockjs-client';

export const BACKOFF_INITIAL_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** A connection that stayed open this long resets the backoff. */
export const HEALTHY_AFTER_MS = 60_000;
/** The warrior sends a `timestamp` every second; silence this long means the socket is dead. */
export const WATCHDOG_MS = 10_000;
export const PRUNE_INTERVAL_MS = 5_000;

export type WarriorConnectionRecord = Pick<
  WarriorRecord,
  'id' | 'name' | 'host' | 'port' | 'enabled'
>;

export interface WarriorConnectionOptions {
  record: WarriorConnectionRecord;
  createClient?: (host: string, port: number) => SockJsClientLike;
  now?: () => number;
  random?: () => number;
  metrics?: MetricsSink;
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}

/**
 * What changed on the snapshot, so the fleet service can push the smallest thing that keeps
 * clients in sync.
 */
export type WarriorUpdate =
  /** Several fields changed at once (open, `project.refresh`, rename); clients need the snapshot. */
  | { kind: 'snapshot' }
  /** Only `snapshot.connection` changed. */
  | { kind: 'connection' }
  /** One warrior event was applied; clients replay it with the shared reducer. */
  | { kind: 'event'; event: TimedEvent }
  /** Finished items aged out; clients prune on their own clock, totals need recomputing. */
  | { kind: 'pruned' };

export interface WarriorConnectionEvents {
  update: [update: WarriorUpdate];
}

/**
 * Owns one warrior's SockJS session and its live snapshot. Reconnects with jittered
 * exponential backoff and treats ten seconds of silence as a dead socket.
 */
export class WarriorConnection extends EventEmitter<WarriorConnectionEvents> {
  readonly snapshot: WarriorSnapshot;

  private client: SockJsClientLike | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly createClient: (host: string, port: number) => SockJsClientLike;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly metrics: MetricsSink | undefined;
  private readonly log: NonNullable<WarriorConnectionOptions['log']>;

  constructor(options: WarriorConnectionOptions) {
    super();
    this.createClient =
      options.createClient ?? ((host, port) => new SockJsClient(sockJsSessionUrl(host, port)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.metrics = options.metrics;
    this.log = options.log ?? (() => undefined);
    this.snapshot = createSnapshot(options.record, this.now());
    if (!options.record.enabled) this.snapshot.connection.state = 'offline';
  }

  public get id(): string {
    return this.snapshot.id;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.snapshot.connection.attempts = 0;
    this.pruneTimer = setInterval(() => {
      if (pruneFinishedItems(this.snapshot, this.now())) this.emit('update', { kind: 'pruned' });
    }, PRUNE_INTERVAL_MS);
    this.connect();
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearTimers();
    const client = this.client;
    this.client = null;
    client?.close();
    this.snapshot.connection.state = 'offline';
    this.snapshot.updatedAt = this.now();
    this.emit('update', { kind: 'connection' });
  }

  /** Update display fields that do not require a reconnect. */
  public rename(name: string): void {
    if (this.snapshot.name === name) return;
    this.snapshot.name = name;
    this.snapshot.updatedAt = this.now();
    this.emit('update', { kind: 'snapshot' });
  }

  private connect(): void {
    if (!this.running) return;
    const { connection } = this.snapshot;
    connection.state = connection.attempts === 0 ? 'connecting' : 'reconnecting';
    this.snapshot.updatedAt = this.now();
    this.emit('update', { kind: 'connection' });

    const client = this.createClient(this.snapshot.host, this.snapshot.port);
    this.client = client;

    client.on('open', () => {
      if (this.client !== client) return;
      this.log('info', `connected to ${this.snapshot.host}:${this.snapshot.port}`);
      const now = this.now();
      resetLiveState(this.snapshot, now);
      connection.state = 'connected';
      connection.connectedAt = now;
      connection.lastSeenAt = now;
      connection.lastError = null;
      this.emit('update', { kind: 'snapshot' });
    });

    client.on('frame', () => {
      if (this.client !== client) return;
      this.snapshot.connection.lastSeenAt = this.now();
      this.armWatchdog();
    });

    client.on('event', (envelope) => {
      if (this.client !== client) return;
      this.handleEvent(envelope as WarriorEvent);
    });

    client.on('close', (reason) => {
      if (this.client !== client) return;
      this.client = null;
      this.handleClose(reason);
    });

    // Also covers a TCP connect that hangs: no frame within the watchdog window means retry.
    this.armWatchdog();
    client.connect();
  }

  private handleEvent(event: WarriorEvent): void {
    const now = this.now();
    const changed = applyEvent(this.snapshot, event, now);
    if (event.event_name === 'bandwidth' && this.snapshot.bandwidth) {
      this.metrics?.onBandwidth(this.ref(), this.snapshot.bandwidth);
    } else if (
      event.event_name === 'item.complete' ||
      event.event_name === 'item.fail' ||
      event.event_name === 'item.cancel'
    ) {
      const item = this.snapshot.items.find((i) => i.id === event.message.item_id);
      if (item)
        this.metrics?.onItemFinished(this.ref(), item, this.snapshot.project?.title ?? null);
    }
    if (!changed) return;
    // `project.refresh` carries every item's full output; the reduced snapshot is smaller.
    if (event.event_name === 'project.refresh') this.emit('update', { kind: 'snapshot' });
    else this.emit('update', { kind: 'event', event: { at: now, event } });
  }

  private handleClose(reason: string): void {
    this.clearWatchdog();
    if (!this.running) return;
    const { connection } = this.snapshot;
    const now = this.now();
    const wasHealthy =
      connection.connectedAt !== null && now - connection.connectedAt >= HEALTHY_AFTER_MS;
    if (wasHealthy) connection.attempts = 0;
    connection.attempts += 1;
    connection.connectedAt = null;
    connection.lastError = reason;
    connection.state = 'reconnecting';
    this.snapshot.updatedAt = now;

    const delay = this.backoffDelay(connection.attempts);
    this.log(
      'warn',
      `${this.snapshot.host}:${this.snapshot.port} disconnected (${reason}); retry in ${Math.round(delay)}ms`,
    );
    this.emit('update', { kind: 'connection' });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** 1s, 2s, 4s ... capped at 30s, each multiplied by a jitter factor in [0.5, 1.5). */
  private backoffDelay(attempt: number): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** Math.max(0, attempt - 1));
    return base * (0.5 + this.random());
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      const client = this.client;
      if (!client) return;
      this.log(
        'warn',
        `${this.snapshot.host}:${this.snapshot.port} silent for ${WATCHDOG_MS}ms; reconnecting`,
      );
      this.client = null;
      client.close();
      this.handleClose(`no messages for ${WATCHDOG_MS / 1000}s`);
    }, WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private clearTimers(): void {
    this.clearWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  private ref() {
    const { id, name, host, port } = this.snapshot;
    return { id, name, host, port };
  }
}
