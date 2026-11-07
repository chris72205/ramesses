import { describe, expect, it } from 'vitest';
import { parseHostLine } from './api';
import { formatBytes, formatDuration, formatRate } from './format';

describe('format', () => {
  it('formats bytes in decimal units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1234)).toBe('1.23 kB');
    expect(formatBytes(45_500_000)).toBe('45.5 MB');
    expect(formatBytes(310_100_000)).toBe('310 MB');
    expect(formatRate(1234)).toBe('1.23 kB/s');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(65)).toBe('1m 05s');
    expect(formatDuration(3725)).toBe('1h 02m');
    expect(formatDuration(90_000)).toBe('1d 1h');
  });
});

describe('parseHostLine', () => {
  it('parses host and optional port', () => {
    expect(parseHostLine('  ')).toBeNull();
    expect(parseHostLine('192.0.2.10')).toEqual({ host: '192.0.2.10' });
    expect(parseHostLine('192.0.2.10:8003')).toEqual({ host: '192.0.2.10', port: 8003 });
    expect(parseHostLine('warrior.lan:81')).toEqual({ host: 'warrior.lan', port: 81 });
  });
});

describe('formatWindow', () => {
  it('prefers minutes when whole', async () => {
    const { formatWindow } = await import('./format');
    expect(formatWindow(300_000)).toBe('5 min');
    expect(formatWindow(60_000)).toBe('1 min');
    expect(formatWindow(90_000)).toBe('90 s');
  });
});

describe('formatClock', () => {
  it('renders local time as zero-padded HH:MM:SS', async () => {
    const { formatClock } = await import('./format');
    expect(formatClock(new Date(2026, 0, 1, 14, 5, 9).getTime())).toBe('14:05:09');
    expect(formatClock(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe('00:00:00');
  });
});
