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
  await expect(table.getByText('★ Recommended by Archive Team')).toBeVisible();

  await blogger.getByRole('link', { name: 'Blogger' }).click();
  await expect(page).toHaveURL(/\/projects\/blogger$/);
  await expect(page.getByRole('heading', { name: 'Blogger' })).toBeVisible();
  await expect(page.getByText('checked out to workers')).toBeVisible();
  await expect(page.getByRole('img', { name: /Items to do/ })).toBeVisible();

  await page.getByRole('tab', { name: '7 days' }).click();
  await expect(page.getByText(/hourly points? over the last 7 days/)).toBeVisible();
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
