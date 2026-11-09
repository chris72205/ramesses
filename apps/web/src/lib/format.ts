const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'];

/** "1 warrior" or "3 warriors": the count with the noun in the matching number. */
export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** 1234567 -> "1.2 MB" (decimal units, like the warrior UI). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds -> "1h 02m 03s" style, compact. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** ms since epoch -> "12s ago" / "3m ago". */
export function formatAgo(at: number | null, now: number): string {
  if (at === null) return 'never';
  return `${formatDuration((now - at) / 1000)} ago`;
}

/** 300000 -> "5 min", 60000 -> "1 min", 90000 -> "90 s". */
export function formatWindow(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** ms since epoch -> local wall-clock "14:05:09". */
export function formatClock(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** 1284 -> "1,284", 12900 -> "12.9K", 28_054_000_000 -> "28.1B". Compact once past five digits. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  const abs = Math.abs(value);
  if (abs < 10_000) return Math.round(value).toLocaleString('en-US');
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      return `${scaled.toFixed(Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0)}${suffix}`;
    }
  }
  return String(value);
}

/** Items per hour, or an em dash when there is no rate yet. */
export function formatPerHour(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '\u2014';
  return `${formatCount(value)}/h`;
}

/** Time left until an ISO deadline: "3d 4h left", "closed" once it has passed. */
export function formatTimeLeft(deadline: string | null, now: number): string | null {
  if (!deadline) return null;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at)) return null;
  if (at <= now) return 'closed';
  return `${formatDuration((at - now) / 1000)} left`;
}

/** ISO timestamp -> local "Nov 7, 14:05". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** ISO timestamp (or null) -> "12s ago" / "never". */
export function formatIsoAgo(iso: string | null, now: number): string {
  return formatAgo(iso ? Date.parse(iso) : null, now);
}
