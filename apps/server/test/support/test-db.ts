import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

// Tests run from the package directory; pick up the same .env the app uses.
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

/**
 * Integration and e2e tests run against a dedicated database so they never touch the
 * development data. Derived from DATABASE_URL by appending `_test` to the database name,
 * or taken from DATABASE_URL_TEST when set.
 */
export function testDatabaseUrl(): string {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error('DATABASE_URL (or DATABASE_URL_TEST) is required for integration tests');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

/** Create the test database if it does not exist. */
export async function ensureTestDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

export async function truncateAll(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Tolerate a brand-new database whose migrations have not run yet.
    await client.query(
      "DO $$ BEGIN IF to_regclass('public.warriors') IS NOT NULL THEN TRUNCATE TABLE warriors; END IF; END $$",
    );
  } finally {
    await client.end();
  }
}
