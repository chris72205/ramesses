import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ensureTestDatabase, testDatabaseUrl, truncateAll } from './test-db';

/**
 * Boot the real application against the test database. Call before importing app code so
 * the environment is fixed before `loadEnv()` caches it.
 */
export async function bootTestApp(
  env: Record<string, string> = {},
): Promise<{ app: NestFastifyApplication; databaseUrl: string }> {
  const databaseUrl = testDatabaseUrl();
  await ensureTestDatabase(databaseUrl);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL ??= 'redis://localhost:6380';
  process.env.LOG_LEVEL ??= 'warn';
  // Keep test replicas out of a dev server's election and channels on the same Redis.
  process.env.REDIS_KEY_PREFIX ??= `ramesses-test-${process.pid}`;
  process.env.LEADER_RENEW_MS ??= '200';
  process.env.LEADER_TTL_MS ??= '1000';
  // Tests that want the sampler turn it on and point it at a fake tracker.
  process.env.PROJECTS_SAMPLING_ENABLED ??= 'false';
  Object.assign(process.env, env);
  delete process.env.WEB_DIST;
  // Clear leftovers before the app boots so FleetService starts from an empty list.
  await truncateAll(databaseUrl);
  const { createApp } = await import('../../src/app.js');
  const app = await createApp();
  await app.init();
  // No truncate after init: the leader may already have sampled the fake tracker during boot.
  return { app, databaseUrl };
}
