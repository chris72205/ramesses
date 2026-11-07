import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

/**
 * Minimal SockJS client over the WebSocket transport, using Node's built-in WebSocket.
 *
 * The warrior mounts SockJS at the root of its web port. The raw `/websocket` endpoint only
 * receives the connect burst, so we use the session path `/<server>/<session>/websocket`,
 * which receives broadcasts too. Frames: `o` open, `h` heartbeat, `a[...]` messages,
 * `c[code,"reason"]` close.
 */

export interface SockJsEnvelope {
  event_name: string;
  message: unknown;
}

export interface SockJsClientEvents {
  open: [];
  /** any frame arrived, including heartbeats; used for liveness */
  frame: [];
  event: [envelope: SockJsEnvelope];
  close: [reason: string];
}

export interface SockJsClientLike {
  on<K extends keyof SockJsClientEvents>(
    event: K,
    listener: (...args: SockJsClientEvents[K]) => void,
  ): this;
  connect(): void;
  close(): void;
}

export function sockJsSessionUrl(host: string, port: number): string {
  const server = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const session = randomBytes(6).toString('base64url');
  return `ws://${host}:${port}/${server}/${session}/websocket`;
}

export class SockJsClient extends EventEmitter<SockJsClientEvents> implements SockJsClientLike {
  private socket: WebSocket | null = null;
  private closedByUs = false;

  constructor(private readonly url: string) {
    super();
  }

  connect(): void {
    this.closedByUs = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('message', (ev) => this.handleFrame(String(ev.data)));
    socket.addEventListener('error', () => {
      // 'close' always follows 'error' on the WHATWG WebSocket; report there.
    });
    socket.addEventListener('close', (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const reason = this.closedByUs
        ? 'closed'
        : ev.reason || (ev.code === 1006 ? 'connection failed or dropped' : `code ${ev.code}`);
      this.emit('close', reason);
    });
  }

  close(): void {
    this.closedByUs = true;
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }

  private handleFrame(raw: string): void {
    this.emit('frame');
    if (raw.length === 0) return;
    const kind = raw[0];
    if (kind === 'o') {
      this.emit('open');
      return;
    }
    if (kind === 'h') return;
    if (kind === 'c') {
      let reason = 'server closed session';
      try {
        const [, text] = JSON.parse(raw.slice(1)) as [number, string];
        if (text) reason = text;
      } catch {
        // keep default
      }
      this.closedByUs = true; // suppress generic reason; we report the server's
      this.socket?.close();
      this.socket = null;
      this.emit('close', reason);
      return;
    }
    if (kind === 'a' || kind === 'm') {
      let payloads: string[];
      try {
        payloads = kind === 'a' ? (JSON.parse(raw.slice(1)) as string[]) : [raw.slice(1)];
      } catch {
        return;
      }
      for (const payload of payloads) {
        let envelope: SockJsEnvelope;
        try {
          envelope = JSON.parse(payload) as SockJsEnvelope;
        } catch {
          continue;
        }
        if (envelope && typeof envelope.event_name === 'string') this.emit('event', envelope);
      }
    }
  }
}
