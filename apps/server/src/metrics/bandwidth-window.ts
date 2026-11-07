import type { BandwidthSample, RollingStats } from '@ramesses/shared';

/**
 * Bandwidth samples live in one Redis sorted set per warrior, scored by timestamp so a
 * trailing window is a single ZRANGEBYSCORE and trimming is a single ZREMRANGEBYSCORE.
 * Members encode the whole sample so nothing else needs to be stored.
 */
export const bandwidthKey = (warriorId: string): string => `ramesses:bandwidth:${warriorId}`;

export function encodeSample(sample: BandwidthSample): string {
  return [sample.at, sample.receiving, sample.sending, sample.received, sample.sent].join('|');
}

export function decodeSample(member: string): BandwidthSample | null {
  const parts = member.split('|').map(Number);
  if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return null;
  const [at, receiving, sending, received, sent] = parts as [
    number,
    number,
    number,
    number,
    number,
  ];
  return { at, receiving, sending, received, sent };
}

export function computeWindowStats(samples: BandwidthSample[], windowMs: number): RollingStats {
  let sumReceiving = 0;
  let sumSending = 0;
  let peakReceiving = 0;
  let peakSending = 0;
  for (const s of samples) {
    sumReceiving += s.receiving;
    sumSending += s.sending;
    if (s.receiving > peakReceiving) peakReceiving = s.receiving;
    if (s.sending > peakSending) peakSending = s.sending;
  }
  const n = samples.length;
  return {
    windowMs,
    samples: n,
    avgReceiving: n ? sumReceiving / n : 0,
    avgSending: n ? sumSending / n : 0,
    peakReceiving,
    peakSending,
  };
}
