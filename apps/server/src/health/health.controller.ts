import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { LeaderHealthIndicator } from './leader-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly leader: LeaderHealthIndicator,
  ) {}

  /** Liveness: the process is up and serving HTTP. */
  @Get('live')
  @HealthCheck()
  public live() {
    return this.health.check([]);
  }

  /** Readiness: dependencies this process needs to do useful work. */
  @Get('ready')
  @HealthCheck()
  public ready() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 2000 }),
      () => this.redis.isHealthy('redis'),
      () => this.leader.report('leader'),
    ]);
  }

  /** Alias of readiness for humans and simple probes. */
  @Get()
  @HealthCheck()
  public check() {
    return this.ready();
  }
}
