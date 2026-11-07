const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'];

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
