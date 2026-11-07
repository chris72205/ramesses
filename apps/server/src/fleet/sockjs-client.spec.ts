import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SockJsClient, sockJsSessionUrl } from './sockjs-client';

type Listener = (event: { data?: string; code?: number; reason?: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners = new Map<string, Listener[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: { data?: string; code?: number; reason?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(payload);
  }
}

describe('SockJsClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('builds a session url on the sockjs session path', () => {
    expect(sockJsSessionUrl('10.0.0.1', 8001)).toMatch(
      /^ws:\/\/10\.0\.0\.1:8001\/\d{3}\/[A-Za-z0-9_-]{8}\/websocket$/,
    );
  });

  it('parses open, heartbeat, array, and close frames', () => {
    const client = new SockJsClient('ws://x/000/abc/websocket');
    const open = vi.fn();
    const frame = vi.fn();
    const event = vi.fn();
    const close = vi.fn();
    client.on('open', open).on('frame', frame).on('event', event).on('close', close);
    client.connect();
    const socket = FakeWebSocket.instances[0]!;

    socket.emit('message', { data: 'o' });
    socket.emit('message', { data: 'h' });
    socket.emit('message', {
      data:
        'a[' +
        JSON.stringify(
          JSON.stringify({ event_name: 'warrior.status', message: { status: 'NO_PROJECT' } }),
        ) +
        ',"not json"]',
    });
    socket.emit('message', { data: 'c[3000,"Go away!"]' });

    expect(open).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenCalledTimes(4);
    expect(event).toHaveBeenCalledWith({
      event_name: 'warrior.status',
      message: { status: 'NO_PROJECT' },
    });
    expect(close).toHaveBeenCalledWith('Go away!');
    expect(socket.closed).toBe(true);
  });

  it('accepts single-message m frames and ignores unparsable frames', () => {
    const client = new SockJsClient('ws://x/000/abc/websocket');
    const event = vi.fn();
    client.on('event', event);
    client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.emit('message', {
      data: 'm' + JSON.stringify({ event_name: 'timestamp', message: { timestamp: 1 } }),
    });
    socket.emit('message', { data: 'a[not json' });
    socket.emit('message', { data: '' });
    socket.emit('message', { data: 'c[garbage' });
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('reports a dropped socket with a readable reason', () => {
    const client = new SockJsClient('ws://x/000/abc/websocket');
    const close = vi.fn();
    client.on('close', close);
    client.connect();
    FakeWebSocket.instances[0]!.emit('close', { code: 1006, reason: '' });
    expect(close).toHaveBeenCalledWith('connection failed or dropped');
  });

  it('reports "closed" when we closed it', () => {
    const client = new SockJsClient('ws://x/000/abc/websocket');
    const close = vi.fn();
    client.on('close', close);
    client.connect();
    client.close();
    FakeWebSocket.instances[0]!.emit('close', { code: 1000, reason: '' });
    expect(close).toHaveBeenCalledWith('closed');
  });
});
