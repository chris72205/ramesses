import { describe, expect, it } from 'vitest';
import { bandwidthKey, computeWindowStats, decodeSample, encodeSample } from './bandwidth-window';

describe('bandwidth window helpers', () => {
  it('round-trips samples through the member encoding', () => {
    const sample = { at: 1700000000000, receiving: 12.5, sending: 3, received: 1e9, sent: 5e8 };
    expect(decodeSample(encodeSample(sample))).toEqual(sample);
    expect(decodeSample('garbage')).toBeNull();
    expect(decodeSample('1|2|3')).toBeNull();
    expect(bandwidthKey('abc')).toBe('ramesses:bandwidth:abc');
  });

  it('computes averages and peaks, and handles an empty window', () => {
    expect(computeWindowStats([], 300_000)).toEqual({
      windowMs: 300_000,
      samples: 0,
      avgReceiving: 0,
      avgSending: 0,
      peakReceiving: 0,
      peakSending: 0,
    });
    const stats = computeWindowStats(
      [
        { at: 1, receiving: 10, sending: 1, received: 0, sent: 0 },
        { at: 2, receiving: 30, sending: 3, received: 0, sent: 0 },
      ],
      60_000,
    );
    expect(stats).toEqual({
      windowMs: 60_000,
      samples: 2,
      avgReceiving: 20,
      avgSending: 2,
      peakReceiving: 30,
      peakSending: 3,
    });
  });
});
