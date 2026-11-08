import type { DoneRates, QueueHealth, TodoDistribution, TrendPoint } from '@ramesses/shared';

/** A stored sample with its time as epoch milliseconds, oldest first when in arrays. */
export interface SamplePoint {
  at: number;
  todo: number;
  out: number;
  done: number;
  downloaderCount: number;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Starting thresholds for the queue-health label, to be tuned once a week of real samples
 * exists. `availability` is the share of 24-hour samples with `todo` above zero.
 */
export const HEALTH_THRESHOLDS = {
  /** below this availability the queue counts as drained ... */
  drainedBelow: 0.2,
  /** ... unless it ever climbed above this many items, which means a refill happened */
  drainedMaxTodo: 1_000,
  /** at or above this availability work was there whenever asked */
  healthyAtLeast: 0.8,
  /** a healthy queue whose median depth exceeds this is a backlog */
  backlogMedianTodo: 1_000_000,
  /** fewer samples than this and the label is `unknown` */
  minSamples: 2,
} as const;

/** Items completed per hour between the first and last sample inside the trailing window. */
export function doneRate(samples: SamplePoint[], windowMs: number, now: number): number | null {
  const since = now - windowMs;
  const inWindow = samples.filter((s) => s.at >= since);
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (!first || !last || first === last || last.at <= first.at) return null;
  const delta = last.done - first.done;
  // A negative delta means the tracker reset its counters; there is no honest rate for that.
  if (delta < 0) return null;
  return delta / ((last.at - first.at) / HOUR_MS);
}

export function doneRates(samples: SamplePoint[], now: number): DoneRates {
  return {
    h1: doneRate(samples, HOUR_MS, now),
    h6: doneRate(samples, 6 * HOUR_MS, now),
    h24: doneRate(samples, DAY_MS, now),
  };
}

/** Distribution of `todo` across the samples given (callers pass the trailing 24 hours). */
export function todoDistribution(samples: SamplePoint[]): TodoDistribution | null {
  if (samples.length === 0) return null;
  const sorted = samples.map((s) => s.todo).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    min: sorted[0]!,
    median,
    max: sorted[sorted.length - 1]!,
    availability: sorted.filter((t) => t > 0).length / sorted.length,
    samples: sorted.length,
  };
}

/**
 * Label the queue from its distribution, never from one reading: a project between batch
 * refills reads as drained for a moment but is intermittent over a day.
 */
export function queueHealth(dist: TodoDistribution | null): QueueHealth {
  if (!dist || dist.samples < HEALTH_THRESHOLDS.minSamples) return 'unknown';
  if (dist.availability >= HEALTH_THRESHOLDS.healthyAtLeast) {
    return dist.median > HEALTH_THRESHOLDS.backlogMedianTodo ? 'backlog' : 'healthy';
  }
  if (
    dist.availability < HEALTH_THRESHOLDS.drainedBelow &&
    dist.max <= HEALTH_THRESHOLDS.drainedMaxTodo
  ) {
    return 'drained';
  }
  return 'intermittent';
}

/** Completion rate for each interval between consecutive samples, for the sparkline. */
export function trend(samples: SamplePoint[]): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const curr = samples[i]!;
    const hours = (curr.at - prev.at) / HOUR_MS;
    if (hours <= 0) continue;
    points.push({
      at: new Date(curr.at).toISOString(),
      perHour: Math.max(0, curr.done - prev.done) / hours,
    });
  }
  return points;
}

/** Rate since the previous point, for history series; null for the first point and resets. */
export function donePerHourSeries(samples: SamplePoint[]): Array<number | null> {
  return samples.map((curr, i) => {
    const prev = samples[i - 1];
    if (!prev || curr.at <= prev.at || curr.done < prev.done) return null;
    return (curr.done - prev.done) / ((curr.at - prev.at) / HOUR_MS);
  });
}

export interface DerivedMetrics {
  doneRate: DoneRates;
  todo24h: TodoDistribution | null;
  health: QueueHealth;
  trend: TrendPoint[];
}

/** Everything the summary needs from the trailing 24 hours of samples (oldest first). */
export function deriveMetrics(samples: SamplePoint[], now: number): DerivedMetrics {
  const last24h = samples.filter((s) => s.at >= now - DAY_MS);
  const dist = todoDistribution(last24h);
  return {
    doneRate: doneRates(last24h, now),
    todo24h: dist,
    health: queueHealth(dist),
    trend: trend(last24h),
  };
}
