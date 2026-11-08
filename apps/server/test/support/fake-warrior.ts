import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WarriorEvent } from '@ramesses/shared';
import burst from '../../../../packages/shared/test/fixtures/connect-burst.json';

export interface FakeWarriorOptions {
  /** interval between bandwidth/timestamp ticks; the real warrior uses 1000ms */
  tickMs?: number;
  /** events to send right after the SockJS open frame */
  burst?: WarriorEvent[];
}

/**
 * A minimal stand-in for a warrior's SockJS endpoint: accepts the session websocket path,
 * sends the open frame, replays a connect burst, then ticks bandwidth and timestamp.
 */
export class FakeWarrior {
  readonly sockets = new Set<WebSocket>();
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly tickMs: number;
  private readonly burst: WarriorEvent[];
  private tickers = new Map<WebSocket, NodeJS.Timeout>();
  private received = 0;
  private sent = 0;
  connections = 0;

  constructor(options: FakeWarriorOptions = {}) {
    this.tickMs = options.tickMs ?? 200;
    this.burst = options.burst ?? (burst as WarriorEvent[]);
    this.http = createServer((_, res) => {
      res.statusCode = 404;
      res.end();
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      if (!/^\/\d{3}\/[^/]+\/websocket$/.test(req.url ?? '')) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
  }

  public get port(): number {
    const address = this.http.address();
    if (!address || typeof address === 'string') throw new Error('not listening');
    return address.port;
  }

  public async start(): Promise<this> {
    this.http.listen(0, '127.0.0.1');
    await once(this.http, 'listening');
    return this;
  }

  public async stop(): Promise<void> {
    for (const ws of this.sockets) ws.terminate();
    for (const timer of this.tickers.values()) clearInterval(timer);
    this.tickers.clear();
    this.wss.close();
    this.http.close();
    await once(this.http, 'close').catch(() => undefined);
  }

  /** Push one event to every connected session. */
  public emit(event: WarriorEvent): void {
    const frame = 'a' + JSON.stringify([JSON.stringify(event)]);
    for (const ws of this.sockets) if (ws.readyState === ws.OPEN) ws.send(frame);
  }

  /** Stop ticking without closing, to simulate a hung socket. */
  public goSilent(): void {
    for (const timer of this.tickers.values()) clearInterval(timer);
    this.tickers.clear();
  }

  /** Close every session the way a restarting warrior would. */
  public dropAll(): void {
    for (const ws of this.sockets) ws.close(1001, 'restarting');
  }

  private accept(ws: WebSocket): void {
    this.connections += 1;
    this.sockets.add(ws);
    ws.send('o');
    for (const event of this.burst) ws.send('a' + JSON.stringify([JSON.stringify(event)]));
    const timer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      this.received += 1000;
      this.sent += 100;
      const tick: WarriorEvent[] = [
        {
          event_name: 'bandwidth',
          message: { received: this.received, sent: this.sent, receiving: 1000, sending: 100 },
        },
        { event_name: 'timestamp', message: { timestamp: Date.now() / 1000 } },
      ];
      ws.send('a' + JSON.stringify(tick.map((e) => JSON.stringify(e))));
    }, this.tickMs);
    this.tickers.set(ws, timer);
    ws.on('close', () => {
      this.sockets.delete(ws);
      const t = this.tickers.get(ws);
      if (t) clearInterval(t);
      this.tickers.delete(ws);
    });
  }
}
