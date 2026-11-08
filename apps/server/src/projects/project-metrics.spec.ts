import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  deriveMetrics,
  donePerHourSeries,
  doneRate,
  HEALTH_THRESHOLDS,
  HOUR_MS,
  queueHealth,
  todoDistribution,
  trend,
  type SamplePoint,
} from './project-metrics';

const NOW = 1_800_000_000_000;
const QUARTER_HOUR = HOUR_MS / 4;

/** `n` samples at 15-minute spacing ending at NOW; `todo` and `done` come from the callbacks. */
function series(
  n: number,
  todo: (i: number) => number,
  done: (i: number) => number,
): SamplePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    at: NOW - (n - 1 - i) * QUARTER_HOUR,
    todo: todo(i),
    out: 0,
    done: done(i),
    downloaderCount: 10,
  }));
}

describe('doneRate', () => {
  it('needs two samples inside the window', () => {
    expect(doneRate([], HOUR_MS, NOW)).toBeNull();
    expect(
      doneRate(
        series(
          1,
          () => 1,
          () => 1,
        ),
        HOUR_MS,
        NOW,
      ),
    ).toBeNull();
    // five samples span one hour; a 30-minute window holds only the last three
    const s = series(
      5,
      () => 1,
      (i) => i * 100,
    );
    expect(doneRate(s, HOUR_MS, NOW)).toBe(400);
    expect(doneRate(s, HOUR_MS / 2, NOW)).toBe(400);
  });

  it('is null when the counter went backwards (tracker reset)', () => {
    expect(
      doneRate(
        series(
          3,
          () => 1,
          (i) => 1000 - i,
        ),
        HOUR_MS,
        NOW,
      ),
    ).toBeNull();
  });
});

describe('todoDistribution and queueHealth', () => {
  it('is unknown without enough samples', () => {
    expect(todoDistribution([])).toBeNull();
    expect(queueHealth(null)).toBe('unknown');
    expect(
      queueHealth(
        todoDistribution(
          series(
            1,
            () => 5,
            () => 0,
          ),
        ),
      ),
    ).toBe('unknown');
  });

  it('labels a project that is drained for most of the day', () => {
    // 96 samples, todo above zero in 10 of them and never above a small number
    const dist = todoDistribution(
      series(
        96,
        (i) => (i % 10 === 0 ? 7 : 0),
        () => 0,
      ),
    )!;
    expect(dist.availability).toBeCloseTo(10 / 96);
    expect(dist.max).toBe(7);
    expect(queueHealth(dist)).toBe('drained');
  });

  it('calls a batch-refilled queue intermittent, not drained, even with a low median', () => {
    // Blogger-style: mostly empty, but refilled to thousands a few times a day
    const dist = todoDistribution(
      series(
        96,
        (i) => (i % 8 === 0 ? 8_000 : 0),
        () => 0,
      ),
    )!;
    expect(dist.median).toBe(0);
    expect(queueHealth(dist)).toBe('intermittent');
    // and a queue with work in half the samples is intermittent too
    expect(
      queueHealth(
        todoDistribution(
          series(
            10,
            (i) => (i % 2 ? 50 : 0),
            () => 0,
          ),
        ),
      ),
    ).toBe('intermittent');
  });

  it('labels healthy and backlog by availability and median depth', () => {
    expect(
      queueHealth(
        todoDistribution(
          series(
            10,
            (i) => (i === 0 ? 0 : 500),
            () => 0,
          ),
        ),
      ),
    ).toBe('healthy');
    const deep = todoDistribution(
      series(
        10,
        () => HEALTH_THRESHOLDS.backlogMedianTodo + 1,
        () => 0,
      ),
    );
    expect(queueHealth(deep)).toBe('backlog');
  });

  it('computes an even-length median', () => {
    expect(
      todoDistribution(
        series(
          4,
          (i) => [1, 3, 5, 7][i]!,
          () => 0,
        ),
      )!.median,
    ).toBe(4);
  });
});

describe('trend and donePerHourSeries', () => {
  it('gives one rate per interval and clamps resets to zero in the trend', () => {
    const s = series(
      4,
      () => 1,
      (i) => [0, 100, 50, 150][i]!,
    );
    expect(trend(s).map((p) => p.perHour)).toEqual([400, 0, 400]);
    expect(trend(s)[0]!.at).toBe(new Date(s[1]!.at).toISOString());
    expect(donePerHourSeries(s)).toEqual([null, 400, null, 400]);
  });

  it('skips duplicate timestamps', () => {
    const a = { at: NOW, todo: 0, out: 0, done: 10, downloaderCount: 0 };
    expect(trend([a, { ...a, done: 20 }])).toEqual([]);
    expect(donePerHourSeries([a, { ...a, done: 20 }])).toEqual([null, null]);
  });
});

describe('deriveMetrics', () => {
  it('only looks at the trailing 24 hours', () => {
    const old: SamplePoint = {
      at: NOW - DAY_MS - HOUR_MS,
      todo: 0,
      out: 0,
      done: 0,
      downloaderCount: 0,
    };
    const recent = series(
      5,
      () => 100,
      (i) => i * 10,
    );
    const metrics = deriveMetrics([old, ...recent], NOW);
    expect(metrics.todo24h?.samples).toBe(5);
    expect(metrics.doneRate.h24).toBe(40);
    expect(metrics.doneRate.h1).toBe(40);
    expect(metrics.health).toBe('healthy');
    expect(metrics.trend).toHaveLength(4);
  });
});
