import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ensureTestDatabase, testDatabaseUrl, truncateAll } from './test-db';

/**
 * Boot the real application against the test database. Call before importing app code so
 * the environment is fixed before `loadEnv()` caches it.
 */
export async function bootTestApp(): Promise<{ app: NestFastifyApplication; databaseUrl: string }> {
  const databaseUrl = testDatabaseUrl();
  await ensureTestDatabase(databaseUrl);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL ??= 'redis://localhost:6380';
  process.env.LOG_LEVEL ??= 'warn';
  delete process.env.WEB_DIST;
  // Clear leftovers before the app boots so FleetService starts from an empty list.
  await truncateAll(databaseUrl);
  const { createApp } = await import('../../src/app.js');
  const app = await createApp();
  await app.init();
  await truncateAll(databaseUrl);
  return { app, databaseUrl };
}
