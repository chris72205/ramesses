import {
  applyEvent,
  pruneFinishedItems,
  type FleetTotals,
  type ServerMessage,
  type WarriorSnapshot,
} from '@ramesses/shared';

export type SocketState = 'connecting' | 'open' | 'reconnecting';

const EMPTY_TOTALS: FleetTotals = {
  warriors: 0,
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
  rollingWindowMs: 0,
  avgReceiving: 0,
  avgSending: 0,
};

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 15000;

/**
 * Live fleet state fed by the backend's /ws push channel. One instance for the app.
 *
 * `hello` and `warrior` messages carry full snapshots; everything else is a delta applied in
 * place with the same reducer the backend uses, so the two sides stay identical.
 */
export class FleetStore {
  warriors = $state<Record<string, WarriorSnapshot>>({});
  totals = $state<FleetTotals>(EMPTY_TOTALS);
  socket = $state<SocketState>('connecting');
  /** true once the first hello has arrived */
  ready = $state(false);
  /** ticks every second so relative times re-render */
  now = $state(Date.now());

  readonly list = $derived(
    Object.values(this.warriors).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    ),
  );

  private ws: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  public start(): void {
    this.stopped = false;
    this.clock = setInterval(() => this.tick(), 1000);
    this.connect();
  }

  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.clock) clearInterval(this.clock);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;
    this.socket = this.attempts === 0 ? 'connecting' : 'reconnecting';

    ws.onopen = () => {
      this.attempts = 0;
      this.socket = 'open';
    };
    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(message);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.attempts += 1;
      this.socket = 'reconnecting';
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** (this.attempts - 1));
      this.reconnectTimer = setTimeout(() => this.connect(), delay * (0.5 + Math.random()));
    };
  }

  /** Advance the clock and age out finished items, which the backend no longer pushes. */
  private tick(): void {
    this.now = Date.now();
    for (const warrior of Object.values(this.warriors)) pruneFinishedItems(warrior, this.now);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'hello': {
        const next: Record<string, WarriorSnapshot> = {};
        for (const warrior of message.warriors) next[warrior.id] = warrior;
        this.warriors = next;
        this.totals = message.fleet;
        this.ready = true;
        break;
      }
      case 'warrior':
        this.warriors[message.warrior.id] = message.warrior;
        break;
      case 'warrior_events': {
        const warrior = this.warriors[message.id];
        if (!warrior) break;
        for (const { at, event } of message.events) applyEvent(warrior, event, at);
        break;
      }
      case 'warrior_connection': {
        const warrior = this.warriors[message.id];
        if (warrior) warrior.connection = message.connection;
        break;
      }
      case 'warrior_rolling': {
        const warrior = this.warriors[message.id];
        if (warrior) warrior.rolling = message.rolling;
        break;
      }
      case 'warrior_removed':
        delete this.warriors[message.id];
        break;
      case 'fleet':
        this.totals = message.fleet;
        break;
    }
  }
}

export const fleet = new FleetStore();
