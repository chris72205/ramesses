import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Local development: a .env next to the package wins, then the repository root.
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** How long raw bandwidth samples are kept in Redis. */
  METRICS_RETENTION_SEC: z.coerce.number().int().min(60).default(900),
  /** Trailing window the dashboard aggregates over ("average over the past five minutes"). */
  METRICS_WINDOW_SEC: z.coerce.number().int().min(10).default(300),
  /** Namespace for every Redis key and channel this deployment owns (leader key, pub/sub). */
  REDIS_KEY_PREFIX: z.string().min(1).default('ramesses'),
  /** Leader key TTL. A crashed leader is replaced within this plus one renew interval. */
  LEADER_TTL_MS: z.coerce.number().int().min(1000).default(30_000),
  /** How often the leader renews its key and followers retry to take it. */
  LEADER_RENEW_MS: z.coerce.number().int().min(100).default(10_000),
  /** Turn the tracker sampler off entirely (offline development, seeded test databases). */
  PROJECTS_SAMPLING_ENABLED: z.stringbool().default(true),
  /** How often the leader samples every project's tracker stats. */
  PROJECTS_SAMPLE_INTERVAL_SEC: z.coerce.number().int().min(300).default(900),
  /** How long raw project samples are kept in Postgres. */
  PROJECTS_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  /** Minimum gap between sample runs, which also throttles manual refreshes. */
  PROJECTS_REFRESH_MIN_SEC: z.coerce.number().int().min(0).default(300),
  /** Archive Team project catalog. */
  TRACKER_PROJECTS_URL: z.string().url().default('https://warriorhq.archiveteam.org/projects.json'),
  /** Per-project stats on the universal tracker; `{name}` is replaced by the project slug. */
  TRACKER_STATS_URL_TEMPLATE: z
    .string()
    .url()
    .default('https://v1.api.tracker.archiveteam.org/{name}/stats.json'),
  /** Directory of the built web app to serve from this process (production single-container mode). */
  WEB_DIST: z
    .string()
    .optional()
    .transform((value) => (value ? path.resolve(process.cwd(), value) : undefined)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parse process.env once. Throws a readable error when a required value is missing. */
export function loadEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n  ');
      throw new Error(`Invalid environment:\n  ${issues}`);
    }
    cached = result.data;
  }
  return cached;
}
