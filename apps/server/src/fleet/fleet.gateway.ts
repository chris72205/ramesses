import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@ramesses/shared';
import { ProjectsFeed } from '../projects/projects-feed.service';
import { FleetService } from './fleet.service';

/** Pushes fleet state and the project catalog to browser clients over a plain WebSocket at /ws. */
@WebSocketGateway({ path: '/ws' })
export class FleetGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FleetGateway.name);
  private readonly clients = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeProjects: (() => void) | null = null;

  constructor(
    private readonly fleet: FleetService,
    private readonly projects: ProjectsFeed,
  ) {}

  public onModuleInit(): void {
    this.unsubscribe = this.fleet.subscribe((message) => this.broadcast(message));
    this.unsubscribeProjects = this.projects.subscribe((projects) =>
      this.broadcast({ type: 'projects', projects }),
    );
  }

  public onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribeProjects?.();
    for (const client of this.clients) client.close(1001, 'server shutting down');
    this.clients.clear();
  }

  public handleConnection(client: WebSocket): void {
    this.clients.add(client);
    this.send(client, {
      type: 'hello',
      warriors: this.fleet.snapshots(),
      fleet: this.fleet.totals(),
      projects: this.projects.current,
    });
    this.logger.debug(`client connected (${this.clients.size} total)`);
  }

  public handleDisconnect(client: WebSocket): void {
    this.clients.delete(client);
    this.logger.debug(`client disconnected (${this.clients.size} total)`);
  }

  private broadcast(message: ServerMessage): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private send(client: WebSocket, message: ServerMessage): void {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
  }
}
