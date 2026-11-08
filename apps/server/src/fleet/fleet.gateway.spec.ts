import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { FleetGateway } from './fleet.gateway';
import type { ProjectsFeed } from '../projects/projects-feed.service';
import type { FleetService } from './fleet.service';

function fakeClient(open = true) {
  return {
    OPEN: 1,
    readyState: open ? 1 : 3,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe('FleetGateway', () => {
  it('sends hello on connect, broadcasts fleet pushes to open clients, and closes on shutdown', () => {
    let listener: ((m: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const fleet = {
      snapshots: vi.fn(() => []),
      totals: vi.fn(() => ({ warriors: 0 })),
      subscribe: vi.fn((l: (m: unknown) => void) => {
        listener = l;
        return unsubscribe;
      }),
    } as unknown as FleetService;
    let projectsListener: ((p: unknown[]) => void) | undefined;
    const unsubscribeProjects = vi.fn();
    const feed = {
      current: [{ name: 'blogger' }],
      subscribe: vi.fn((l: (p: unknown[]) => void) => {
        projectsListener = l;
        return unsubscribeProjects;
      }),
    } as unknown as ProjectsFeed;
    const gateway = new FleetGateway(fleet, feed);
    gateway.onModuleInit();

    const open = fakeClient();
    const closed = fakeClient(false);
    gateway.handleConnection(open);
    gateway.handleConnection(closed);
    expect(open.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'hello',
        warriors: [],
        fleet: { warriors: 0 },
        projects: [{ name: 'blogger' }],
      }),
    );
    expect(closed.send).not.toHaveBeenCalled();

    projectsListener?.([{ name: 'blogger' }, { name: 'telegram' }]);
    expect(open.send).toHaveBeenLastCalledWith(
      JSON.stringify({ type: 'projects', projects: [{ name: 'blogger' }, { name: 'telegram' }] }),
    );

    listener?.({ type: 'fleet', fleet: { warriors: 1 } });
    expect(open.send).toHaveBeenCalledTimes(3);
    expect(closed.send).not.toHaveBeenCalled();

    gateway.handleDisconnect(open);
    listener?.({ type: 'fleet', fleet: { warriors: 2 } });
    expect(open.send).toHaveBeenCalledTimes(3);

    gateway.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalled();
    expect(unsubscribeProjects).toHaveBeenCalled();
    expect(closed.close).toHaveBeenCalledWith(1001, 'server shutting down');
  });
});
