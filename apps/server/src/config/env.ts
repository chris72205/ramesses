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
