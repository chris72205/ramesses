import { WebSocket } from 'ws';
import { applyEvent, type ServerMessage, type WarriorSnapshot } from '@ramesses/shared';

/**
 * A browser stand-in: keeps warrior state the way the web store does (full snapshots on hello
 * and `warrior`, the shared reducer for `warrior_events`) and resolves waits in arrival order.
 */
export class PushClient {
  readonly messages: ServerMessage[] = [];
  readonly warriors = new Map<string, WarriorSnapshot>();
  private cursor = 0;
  private readonly ws: WebSocket;
  private waiters: Array<{
    test: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString()
        : Buffer.from(data as ArrayBuffer).toString();
      const message = JSON.parse(text) as ServerMessage;
      this.apply(message);
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.test(message)) return true;
        w.resolve(message);
        return false;
      });
    });
  }

  public open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  /** Resolve with the first message after the previous wait that satisfies `test`. */
  public waitFor<T extends ServerMessage>(
    label: string,
    test: (m: ServerMessage) => m is T,
    timeoutMs = 10_000,
  ): Promise<T> {
    for (let i = this.cursor; i < this.messages.length; i++) {
      const candidate = this.messages[i]!;
      if (test(candidate)) {
        this.cursor = i + 1;
        return Promise.resolve(candidate);
      }
    }
    this.cursor = this.messages.length;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for: ${label}`)),
        timeoutMs,
      );
      this.waiters.push({
        test,
        resolve: (m) => {
          clearTimeout(timer);
          this.cursor = this.messages.length;
          resolve(m as T);
        },
      });
    });
  }

  /** Wait until the locally reduced state for `id` satisfies `predicate`; returns that state. */
  public async waitForState(
    label: string,
    id: string,
    predicate: (w: WarriorSnapshot) => boolean,
    timeoutMs = 10_000,
  ): Promise<WarriorSnapshot> {
    const satisfied = () => {
      const w = this.warriors.get(id);
      return w !== undefined && predicate(w);
    };
    if (!satisfied()) {
      await this.waitFor(
        label,
        (m): m is ServerMessage => ('id' in m ? m.id === id : m.type === 'warrior') && satisfied(),
        timeoutMs,
      );
    }
    return this.warriors.get(id)!;
  }

  public close(): void {
    this.ws.close();
  }

  private apply(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        this.warriors.clear();
        for (const w of message.warriors) this.warriors.set(w.id, w);
        break;
      case 'warrior':
        this.warriors.set(message.warrior.id, message.warrior);
        break;
      case 'warrior_events': {
        const w = this.warriors.get(message.id);
        if (w) for (const { at, event } of message.events) applyEvent(w, event, at);
        break;
      }
      case 'warrior_connection': {
        const w = this.warriors.get(message.id);
        if (w) w.connection = message.connection;
        break;
      }
      case 'warrior_rolling': {
        const w = this.warriors.get(message.id);
        if (w) w.rolling = message.rolling;
        break;
      }
      case 'warrior_removed':
        this.warriors.delete(message.id);
        break;
      case 'fleet':
        break;
    }
  }
}
