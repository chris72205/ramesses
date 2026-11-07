import path from 'node:path';
import { defineConfig } from 'vitest/config';

const here = import.meta.dirname;

/** Workspace runner: `pnpm test` at the root runs every project with one merged coverage report. */
export default defineConfig({
  test: {
    projects: [
      path.join(here, 'packages/shared/vitest.config.mts'),
      path.join(here, 'apps/server/vitest.config.mts'),
      path.join(here, 'apps/web/vite.config.ts'),
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: path.join(here, 'coverage'),
      reporter: ['text', 'html', 'lcov'],
      include: ['apps/*/src/**/*.{ts,svelte}', 'packages/*/src/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        '**/*.d.ts',
        'apps/server/src/main.ts',
        'apps/server/src/database/migrate.ts',
        'apps/server/src/database/migrations/**',
        'apps/web/src/main.ts',
        'apps/web/src/test-setup.ts',
      ],
      // 90% per area (owner requirement), measured separately for shared, backend, and frontend.
      thresholds: {
        'packages/shared/src/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
        'apps/server/src/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
        'apps/web/src/**': { lines: 90, statements: 90, functions: 90, branches: 80 },
      },
    },
  },
});
