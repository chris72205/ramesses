import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { LeaderModule } from '../leader/leader.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { LeaderHealthIndicator } from './leader-health.indicator';
import { RedisHealthIndicator } from './redis-health.indicator';

@Module({
  imports: [TerminusModule, RedisModule, LeaderModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, LeaderHealthIndicator],
})
export class HealthModule {}
