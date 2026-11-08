import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WarriorEvent } from '@ramesses/shared';
import burst from '../../../../packages/shared/test/fixtures/connect-burst.json';

export interface FakeWarriorOptions {
  /** interval between bandwidth/timestamp ticks; the real warrior uses 1000ms */
  tickMs?: number;
  /** events to send right after the SockJS open frame */
  burst?: WarriorEvent[];
  /** when set, `/api/*` demands these basic-auth credentials and answers 401 otherwise */
  auth?: { username: string; password: string };
  /** config keys the settings endpoint rejects no matter what, with the warrior's message */
  settingsErrors?: Record<string, string>;
  /** called for every accepted control command, so a test can react like a warrior would */
  onCommand?: (command: string, fields: Record<string, string>) => void;
}

export interface FakeWarriorRequest {
  method: string;
  path: string;
  fields: Record<string, string>;
}

/** Validation as the warrior's `ConfigValue`s do it. */
function checkSetting(key: string, value: string): string | null {
  if (key === 'downloader' && !/^[-_a-zA-Z0-9]{3,30}$/.test(value)) {
    return 'Invalid value for your nickname.';
  }
  if (key === 'concurrent_items') {
    if (!/^[0-9]+$/.test(value)) return 'Invalid number.';
    if (Number(value) < 1) return 'Number must be 1 or greater.';
    if (Number(value) > 6) return 'Number must be 6 or smaller.';
  }
  return null;
}

/**
 * A minimal stand-in for a warrior: accepts the SockJS session websocket path, sends the open
 * frame, replays a connect burst, then ticks bandwidth and timestamp. Also answers the control
 * endpoints the way the warrior does (`OK`, or the settings HTML fragment) and logs every request.
 */
export class FakeWarrior {
  readonly sockets = new Set<WebSocket>();
  /** every HTTP request to `/api/*`, oldest first */
  readonly requests: FakeWarriorRequest[] = [];
  /** the warrior's config values, as its settings page would show them */
  readonly settings: Record<string, string> = {
    downloader: 'fake',
    concurrent_items: '2',
    http_username: '',
    http_password: '',
    'shared:rsync_threads': '20',
  };
  /** mutable so a test can attach `onCommand` after start */
  readonly options: FakeWarriorOptions;
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private readonly tickMs: number;
  private readonly burst: WarriorEvent[];
  private tickers = new Map<WebSocket, NodeJS.Timeout>();
  private received = 0;
  private sent = 0;
  connections = 0;

  constructor(options: FakeWarriorOptions = {}) {
    this.options = options;
    this.tickMs = options.tickMs ?? 200;
    this.burst = options.burst ?? (burst as WarriorEvent[]);
    this.http = createServer((req, res) => void this.handleHttp(req, res));
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

  /**
   * Answer control commands with the events a warrior would send: a selection is announced,
   * starts, and runs `delayMs` later; a deselect stops and idles `delayMs` later. Items from the
   * recorded burst are left as they are, like a real warrior draining its old pipeline.
   */
  public reactToCommands(delayMs = 300): void {
    const catalog = this.burst.find((e) => e.event_name === 'warrior.projects_loaded');
    const projects =
      catalog?.event_name === 'warrior.projects_loaded' ? catalog.message.projects : {};
    this.options.onCommand = (command, fields) => {
      if (command === 'select-project') {
        const name = fields['project_name']!;
        const title = projects[name]?.title ?? name;
        this.emit({ event_name: 'warrior.project_selected', message: { project: name } });
        this.emit({ event_name: 'warrior.status', message: { status: 'STARTING_PROJECT' } });
        setTimeout(() => {
          this.emit({
            event_name: 'project.refresh',
            message: {
              project: { project_id: 0, title, project_html: '', utc_deadline: null },
              status: 'running',
              items: [],
            },
          });
          this.emit({ event_name: 'warrior.status', message: { status: 'RUNNING_PROJECT' } });
        }, delayMs).unref();
      } else if (command === 'deselect-project') {
        this.emit({ event_name: 'warrior.project_selected', message: { project: null } });
        this.emit({ event_name: 'warrior.status', message: { status: 'STOPPING_PROJECT' } });
        setTimeout(() => {
          this.emit({
            event_name: 'project.refresh',
            message: { project: null, status: 'running', items: [] },
          });
          this.emit({ event_name: 'warrior.status', message: { status: 'NO_PROJECT' } });
        }, delayMs).unref();
      }
    };
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

  /** `/api/<command>` as seesaw's ApiHandler: `OK` for controls, HTML for settings, 200 empty otherwise. */
  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const match = /^\/api\/(.+)$/.exec(req.url ?? '');
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const command = match[1]!;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const fields = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
    this.requests.push({ method: req.method ?? '', path: `/api/${command}`, fields });
    if (this.options.auth && !this.authorized(req)) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Basic realm=ArchiveTeam Warrior');
      res.end('401 Authentication Required');
      return;
    }
    res.setHeader('content-type', 'text/html; charset=UTF-8');
    if (req.method === 'GET') {
      res.end(command === 'settings' ? this.settingsFragment({}) : '');
      return;
    }
    if (command === 'settings') {
      const rejected: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (!(key in this.settings)) continue;
        const error = this.options.settingsErrors?.[key] ?? checkSetting(key, value);
        if (error) rejected[key] = error;
        else this.settings[key] = value;
      }
      this.options.onCommand?.(command, fields);
      res.end(this.settingsFragment(rejected, fields));
      return;
    }
    if (command === 'select-project' || command === 'deselect-project') {
      if (command === 'select-project' && fields['project_name'] === undefined) {
        res.statusCode = 400;
        res.end('<html><title>400: Bad Request</title></html>');
        return;
      }
      this.settings['selected_project'] =
        command === 'select-project' ? fields['project_name']! : 'none';
      this.options.onCommand?.(command, fields);
      res.end('OK');
      return;
    }
    // An unknown command falls through the warrior's handler without writing anything.
    res.end('');
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!header?.startsWith('Basic ')) return false;
    const [username, password] = Buffer.from(header.slice(6), 'base64').toString().split(':');
    return username === this.options.auth!.username && password === this.options.auth!.password;
  }

  /** Shaped like seesaw's templates/settings.html, one <li> per editable value. */
  private settingsFragment(
    errors: Record<string, string>,
    posted: Record<string, string> = {},
  ): string {
    const titles: Record<string, string> = {
      downloader: 'Your nickname',
      concurrent_items: 'Concurrent items',
      http_username: 'HTTP username',
      http_password: 'HTTP password',
      'shared:rsync_threads': 'Rsync threads',
    };
    return Object.entries(titles)
      .map(([key, title], index) => {
        const error = errors[key];
        const value = error ? (posted[key] ?? '') : (this.settings[key] ?? '');
        const classes = `${error ? ' error ' : ''} ${key === 'downloader' ? '' : 'advanced '}`;
        return (
          `<li class="${classes}">\n<p><label for="f-settings-${index}">${title}:</label></p>\n<p>\n` +
          `<input type="text" value="${value}" id="f-settings-${index}" name="${key}" size="30" />\n</p>\n` +
          (error ? `<p class="error">${error}</p>\n` : '') +
          `<p class="info">About ${title.toLowerCase()}.</p>\n</li>\n`
        );
      })
      .join('\n');
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
