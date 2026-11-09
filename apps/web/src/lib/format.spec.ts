import { describe, expect, it } from 'vitest';
import { parseHostLine } from './api';
import { formatBytes, formatDuration, formatRate, pluralize } from './format';

describe('format', () => {
  it('pluralizes a count', () => {
    expect(pluralize(1, 'warrior')).toBe('1 warrior');
    expect(pluralize(0, 'warrior')).toBe('0 warriors');
    expect(pluralize(3, 'warrior')).toBe('3 warriors');
  });

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

describe('project formatters', () => {
  it('compacts counts past five digits', async () => {
    const { formatCount, formatPerHour } = await import('./format');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(9999)).toBe('9,999');
    expect(formatCount(12_900)).toBe('12.9K');
    expect(formatCount(437_000)).toBe('437K');
    expect(formatCount(4_200_000)).toBe('4.20M');
    expect(formatCount(28_054_009_556)).toBe('28.1B');
    expect(formatCount(2.3e12)).toBe('2.30T');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatPerHour(null)).toBe('—');
    expect(formatPerHour(437_000)).toBe('437K/h');
  });

  it('formats deadlines and ISO ages', async () => {
    const { formatTimeLeft, formatIsoAgo, formatDateTime } = await import('./format');
    const now = Date.parse('2026-11-07T12:00:00Z');
    expect(formatTimeLeft(null, now)).toBeNull();
    expect(formatTimeLeft('garbage', now)).toBeNull();
    expect(formatTimeLeft('2026-11-07T11:00:00Z', now)).toBe('closed');
    expect(formatTimeLeft('2026-11-10T16:00:00Z', now)).toBe('3d 4h left');
    expect(formatIsoAgo(null, now)).toBe('never');
    expect(formatIsoAgo('2026-11-07T11:59:30Z', now)).toBe('30s ago');
    expect(formatDateTime('2026-11-07T12:00:00Z')).toMatch(/Nov 7/);
  });
});
