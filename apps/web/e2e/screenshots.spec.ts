import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { WarriorEvent } from '@ramesses/shared';
import { FakeWarrior } from '../../server/test/support/fake-warrior';
import { BACKEND_PORT } from '../playwright.config';

/**
 * Captures every view at desktop and phone width, light and dark, into SCREENSHOTS_DIR.
 * Not a test of behavior: it only runs when that variable is set, so `pnpm test:e2e` and CI
 * skip it. Besides the harness's own fake warrior it starts one with no project and one with
 * a project but no items, so the empty states are in the pictures too.
 */
const outDir = process.env.SCREENSHOTS_DIR;
test.skip(!outDir, 'set SCREENSHOTS_DIR to capture screenshots');
test.describe.configure({ mode: 'serial' });

const backend = `http://localhost:${BACKEND_PORT}`;
// Read rather than imported: Playwright loads specs as ES modules, where JSON needs an import attribute.
const events = JSON.parse(
  readFileSync(
    new URL('../../../packages/shared/test/fixtures/connect-burst.json', import.meta.url),
    'utf8',
  ),
) as WarriorEvent[];

/** The recorded burst, with the project's items emptied. */
const noItemsBurst: WarriorEvent[] = events.map((event) =>
  event.event_name === 'project.refresh' && event.message
    ? { event_name: 'project.refresh', message: { ...event.message, items: [] } }
    : event,
);
/** The recorded burst without a project: status NO_PROJECT and no project.refresh. */
const noProjectBurst: WarriorEvent[] = events
  .filter((event) => event.event_name !== 'project.refresh')
  .map((event) =>
    event.event_name === 'warrior.status'
      ? { event_name: 'warrior.status', message: { status: 'NO_PROJECT' } }
      : event,
  );

const VIEWPORTS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

const extras: FakeWarrior[] = [];

async function capture(page: Page, name: string, settle: () => Promise<void>): Promise<void> {
  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: scheme });
      await settle();
      await page.screenshot({
        path: path.join(outDir!, `${name}-${viewport.label}-${scheme}.png`),
        fullPage: true,
      });
    }
  }
}

test.beforeAll(async ({ request }) => {
  await mkdir(outDir!, { recursive: true });
  // Start from first-run setup whatever the other suites left behind.
  const existing = (await (await request.get(`${backend}/api/warriors`)).json()) as Array<{
    id: string;
  }>;
  for (const warrior of existing) await request.delete(`${backend}/api/warriors/${warrior.id}`);
});

test.afterAll(async () => {
  await Promise.all(extras.map((warrior) => warrior.stop()));
});

test('setup view', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { name: 'Add your warriors' });
  await capture(page, 'setup', () => expect(heading).toBeVisible());
});

test('dashboard with a working, an idle, and an empty warrior', async ({ page, request }) => {
  const idle = await new FakeWarrior({ tickMs: 250, burst: noProjectBurst }).start();
  const empty = await new FakeWarrior({ tickMs: 250, burst: noItemsBurst }).start();
  extras.push(idle, empty);
  const warriors = [
    { host: '127.0.0.1', port: Number(process.env.FAKE_WARRIOR_PORT), name: 'warrior-busy' },
    { host: '127.0.0.1', port: idle.port, name: 'warrior-idle' },
    { host: '127.0.0.1', port: empty.port },
  ];
  for (const data of warriors) await request.post(`${backend}/api/warriors`, { data });

  await page.goto('/');
  const cards = page.locator('article');
  await capture(page, 'dashboard', async () => {
    await expect(cards).toHaveCount(3);
    await expect(cards.getByText('Connected')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByText('No project selected.')).toBeVisible();
    await expect(page.getByText('No items in flight.')).toBeVisible();
  });
});

test('card actions: menu, project picker, and the pending line', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('article');
  await expect(cards.getByText('Connected')).toHaveCount(3, { timeout: 15_000 });
  // The idle extra warrior accepts commands but never reports back, so its pending line stays.
  const idle = cards.filter({ hasText: 'warrior-idle' });
  await idle.getByRole('button', { name: /^Actions for/ }).click();
  await capture(page, 'dashboard-menu', () =>
    expect(idle.getByRole('menuitem', { name: 'Change project…' })).toBeVisible(),
  );
  await idle.getByRole('menuitem', { name: 'Change project…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Telegram/ }).check();
  await capture(page, 'dialog-change-project', () => expect(dialog).toBeVisible());
  await dialog.getByRole('button', { name: 'Switch project' }).click();
  await capture(page, 'dashboard-pending', () => expect(idle.getByRole('status')).toBeVisible());

  await page.getByRole('button', { name: 'Stop all…' }).click();
  await capture(page, 'dialog-stop-all', () =>
    expect(page.getByRole('dialog', { name: 'Stop all warriors' })).toBeVisible(),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  const busy = cards.filter({ hasText: 'warrior-busy' });
  await busy.getByRole('button', { name: /^Actions for/ }).click();
  await busy.getByRole('menuitem', { name: 'Settings…' }).click();
  await capture(page, 'dialog-settings', () =>
    expect(page.getByRole('dialog').getByLabel('Nickname')).toHaveValue('fake'),
  );
});

test('projects index and detail', async ({ page }) => {
  await page.goto('/projects');
  const table = page.locator('main table');
  await capture(page, 'projects', () =>
    expect(table.getByRole('row').filter({ hasText: 'Blogger' })).toBeVisible({
      timeout: 20_000,
    }),
  );
  await page.goto('/projects?mine=running&health=unknown');
  await capture(page, 'projects-filtered', () =>
    expect(table.getByRole('row').filter({ hasText: 'uploader.jp' })).toBeVisible({
      timeout: 20_000,
    }),
  );
  await page.goto('/projects?q=nothing-here&tracker=universal&deadline=1');
  await capture(page, 'projects-filtered-empty', () =>
    expect(page.getByText('No projects match the current filters.')).toBeVisible(),
  );
  await page.goto('/projects/blogger');
  await capture(page, 'project-detail', () =>
    expect(page.getByRole('heading', { name: 'Blogger' })).toBeVisible(),
  );
  await page.goto('/projects/telegram');
  await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible();
  await page.getByRole('button', { name: 'Run on this project…' }).click();
  await capture(page, 'dialog-run-on-project', () =>
    expect(page.getByRole('dialog', { name: 'Run Telegram on…' })).toBeVisible(),
  );
});

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await capture(page, 'settings', () =>
    expect(page.getByRole('heading', { name: 'Warriors' })).toBeVisible(),
  );
});
