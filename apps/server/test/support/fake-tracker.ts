import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import catalog from '../fixtures/tracker/projects.json';
import blogger from '../fixtures/tracker/stats-blogger.json';
import telegram from '../fixtures/tracker/stats-telegram.json';

type Counts = { todo: number; out: number; done: number; rcr?: number };

/**
 * A stand-in for the two tracker endpoints: `/projects.json` and `/<name>/stats.json`. Serves
 * the recorded fixtures, lets tests move the counters between samples, fail a project, and
 * inspect the requests it received.
 */
export class FakeTracker {
  readonly requests: Array<{ url: string; userAgent: string | undefined }> = [];
  catalog: typeof catalog = structuredClone(catalog);
  /** per-project counts; projects not listed here answer 404 */
  counts = new Map<string, Counts>([
    ['blogger', { ...blogger.counts }],
    ['telegram', { ...telegram.counts }],
  ]);
  downloaders = new Map<string, string[]>([
    ['blogger', [...blogger.downloaders]],
    ['telegram', [...telegram.downloaders]],
  ]);
  /** projects that answer 500 */
  failing = new Set<string>();
  private readonly http: Server;

  constructor() {
    this.http = createServer((req, res) => this.handle(req, res));
  }

  public get port(): number {
    const address = this.http.address();
    if (!address || typeof address === 'string') throw new Error('not listening');
    return address.port;
  }

  public get projectsUrl(): string {
    return `http://127.0.0.1:${this.port}/projects.json`;
  }

  public get statsUrlTemplate(): string {
    return `http://127.0.0.1:${this.port}/{name}/stats.json`;
  }

  public async start(): Promise<this> {
    this.http.listen(0, '127.0.0.1');
    await once(this.http, 'listening');
    return this;
  }

  public async stop(): Promise<void> {
    this.http.closeAllConnections();
    this.http.close();
    await once(this.http, 'close').catch(() => undefined);
  }

  /** Back to the recorded fixtures: full catalog, original counts, nothing failing. */
  public reset(): void {
    this.catalog = structuredClone(catalog);
    this.counts = new Map([
      ['blogger', { ...blogger.counts }],
      ['telegram', { ...telegram.counts }],
    ]);
    this.failing.clear();
    this.requests.length = 0;
  }

  /** Advance a project's counters as the real tracker would between samples. */
  public advance(name: string, delta: Partial<Counts>): void {
    const current = this.counts.get(name);
    if (!current) throw new Error(`unknown project ${name}`);
    this.counts.set(name, {
      todo: current.todo + (delta.todo ?? 0),
      out: current.out + (delta.out ?? 0),
      done: current.done + (delta.done ?? 0),
      rcr: current.rcr,
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    this.requests.push({ url, userAgent: req.headers['user-agent'] });
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (url === '/projects.json') return json(200, this.catalog);
    const match = /^\/([^/]+)\/stats\.json$/.exec(url);
    if (!match) return json(404, { error: 'not found' });
    const name = decodeURIComponent(match[1]!);
    if (this.failing.has(name)) return json(500, { error: 'boom' });
    const counts = this.counts.get(name);
    if (!counts) return json(404, { error: 'unknown project' });
    return json(200, {
      counts,
      downloaders: this.downloaders.get(name) ?? [],
      total_items_todo: counts.todo,
      total_items_out: counts.out,
      total_items_done: counts.done,
    });
  }
}
