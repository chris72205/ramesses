import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './projects-sampler.service';

describe('mapWithConcurrency', () => {
  it('keeps result order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n));
      inFlight -= 1;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 3, async (n: number) => n)).toEqual([]);
  });
});
