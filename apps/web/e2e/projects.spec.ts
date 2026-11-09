import { expect, test } from '@playwright/test';
import { BACKEND_PORT } from '../playwright.config';

const fakeWarrior = () => `127.0.0.1:${process.env.FAKE_WARRIOR_PORT}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  // The dashboard suite ends with no warriors, which sends the app back to first-run setup.
  const [host, port] = fakeWarrior().split(':');
  const existing = (await (
    await request.get(`http://localhost:${BACKEND_PORT}/api/warriors`)
  ).json()) as unknown[];
  if (existing.length === 0) {
    await request.post(`http://localhost:${BACKEND_PORT}/api/warriors`, {
      data: { host, port: Number(port) },
    });
  }
});

test('the Projects tab lists sampled projects and links to a detail page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const table = page.locator('main table');
  const blogger = table.getByRole('row').filter({ hasText: 'Blogger' });
  await expect(blogger).toBeVisible({ timeout: 20_000 });
  await expect(blogger.getByText('Unknown')).toBeVisible(); // one sample is never enough to judge
  await expect(
    table
      .getByRole('row')
      .filter({ hasText: 'URLTeam 2' })
      .getByText(/Stats unavailable/),
  ).toBeVisible();
  await expect(table.getByRole('img', { name: 'Recommended by Archive Team' })).toBeVisible();
  // The fake warrior runs uploader.jp, so that row counts one of our warriors.
  const uploader = table.getByRole('row').filter({ hasText: 'uploader.jp' });
  await expect(uploader.getByTitle(fakeWarrior())).toHaveText('1', { timeout: 15_000 });

  await blogger.getByRole('link', { name: 'Blogger' }).click();
  await expect(page).toHaveURL(/\/projects\/blogger$/);
  await expect(page.getByRole('heading', { name: 'Blogger' })).toBeVisible();
  await expect(page.getByText('checked out to workers')).toBeVisible();
  await expect(page.getByRole('img', { name: /Items to do/ })).toBeVisible();

  await page.getByRole('tab', { name: '7 days' }).click();
  await expect(page.getByText(/hourly points? over the last 7 days/)).toBeVisible();
  await expect(page.getByText(/None of your warriors/)).toBeVisible();

  await page.goto('/projects/uploaderjp');
  const mine = page.getByRole('region', { name: /Your warriors on this project/ });
  await expect(mine.getByRole('link', { name: fakeWarrior() })).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByText('connected')).toBeVisible();
});

test('filters combine, live in the URL, and reset from the empty state', async ({ page }) => {
  await page.goto('/projects');
  const table = page.locator('main table');
  await expect(table.getByRole('row').filter({ hasText: 'Blogger' })).toBeVisible({
    timeout: 20_000,
  });
  const filters = page.getByRole('form', { name: 'Filters' });

  // The fake warrior runs uploader.jp, so that is the only project with one of our warriors.
  await filters.getByLabel('Your warriors').selectOption('running');
  await expect(table.getByRole('row').filter({ hasText: 'uploader.jp' })).toBeVisible({
    timeout: 15_000,
  });
  await filters.getByLabel('Search projects').fill('upload');
  await expect(page).toHaveURL(/\/projects\?q=upload&mine=running$/);
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(filters.getByText('1 of')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Search projects')).toHaveValue('upload');
  await expect(page.getByLabel('Your warriors')).toHaveValue('running');
  await expect(table.locator('tbody tr')).toHaveCount(1, { timeout: 20_000 });

  await page.getByLabel('Search projects').fill('nothing-here');
  await expect(page.getByText('No projects match the current filters.')).toBeVisible();
  await expect(
    page.getByText('Active filters: search "nothing-here", running on your warriors.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).last().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(table.getByRole('row').filter({ hasText: 'Blogger' })).toBeVisible();
});

test('a detail URL survives a reload and the tabs switch back', async ({ page }) => {
  await page.goto('/projects/telegram');
  await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('connected / enabled')).toBeVisible();

  await page.goto('/nowhere');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
