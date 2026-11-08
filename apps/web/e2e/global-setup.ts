import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_PORT } from '../playwright.config';
import { FakeTracker } from '../../server/test/support/fake-tracker';
import { FakeWarrior } from '../../server/test/support/fake-warrior';
import {
  ensureTestDatabase,
  testDatabaseUrl,
  truncateAll,
} from '../../server/test/support/test-db';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');

let backend: ChildProcess | undefined;
let fakeWarrior: FakeWarrior | undefined;
let fakeTracker: FakeTracker | undefined;

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

/**
 * Boots the backend (via `nest start`, which builds first) against the test database and a
 * fake warrior. Exposes the fake warrior's port to tests through process.env.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = testDatabaseUrl();
  await ensureTestDatabase(databaseUrl);
  await truncateAll(databaseUrl);

  fakeWarrior = await new FakeWarrior({ tickMs: 250 }).start();
  fakeWarrior.reactToCommands();
  process.env.FAKE_WARRIOR_PORT = String(fakeWarrior.port);
  // The backend samples this stand-in tracker as soon as it elects itself leader.
  fakeTracker = await new FakeTracker().start();

  backend = spawn('pnpm', ['exec', 'nest', 'start'], {
    cwd: serverDir,
    stdio: process.env.PW_DEBUG_BACKEND ? 'inherit' : 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(BACKEND_PORT),
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380',
      LOG_LEVEL: 'warn',
      WEB_DIST: '',
      REDIS_KEY_PREFIX: `ramesses-pw-${process.pid}`,
      LEADER_RENEW_MS: '200',
      LEADER_TTL_MS: '1000',
      PROJECTS_SAMPLING_ENABLED: 'true',
      TRACKER_PROJECTS_URL: fakeTracker.projectsUrl,
      TRACKER_STATS_URL_TEMPLATE: fakeTracker.statsUrlTemplate,
    },
  });
  await waitFor(`http://localhost:${BACKEND_PORT}/api/health/live`, 90_000);

  return async () => {
    backend?.kill('SIGTERM');
    await fakeWarrior?.stop();
    await fakeTracker?.stop();
  };
}
