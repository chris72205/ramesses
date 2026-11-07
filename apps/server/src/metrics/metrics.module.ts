import { Module } from '@nestjs/common';
import { METRICS_SINK } from '../fleet/metrics-sink';
import { RedisModule } from '../redis/redis.module';
import { MetricsService } from './metrics.service';
import { RedisMetricsSink } from './redis-metrics.sink';

@Module({
  imports: [RedisModule],
  providers: [
    RedisMetricsSink,
    MetricsService,
    { provide: METRICS_SINK, useExisting: RedisMetricsSink },
  ],
  exports: [METRICS_SINK, MetricsService, RedisMetricsSink],
})
export class MetricsModule {}
