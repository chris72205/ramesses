import { Injectable } from '@nestjs/common';
import type { BandwidthSample, ItemSnapshot } from '@ramesses/shared';

export interface WarriorRef {
  id: string;
  name: string;
  host: string;
  port: number;
}

/**
 * Receives metrics as they arrive from warriors. The no-op implementation is bound today; an
 * InfluxDB sink later plugs in behind the same token without touching the collector.
 */
export interface MetricsSink {
  onBandwidth(warrior: WarriorRef, sample: BandwidthSample): void;
  onItemFinished(warrior: WarriorRef, item: ItemSnapshot, project: string | null): void;
}

export const METRICS_SINK = Symbol('METRICS_SINK');

@Injectable()
export class NoopMetricsSink implements MetricsSink {
  onBandwidth(): void {}
  onItemFinished(): void {}
}
