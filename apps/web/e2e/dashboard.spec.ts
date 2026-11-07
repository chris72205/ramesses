import { expect, test } from '@playwright/test';

const fakeWarrior = () => `127.0.0.1:${process.env.FAKE_WARRIOR_PORT}`;

test.describe.configure({ mode: 'serial' });

test('first run asks for warriors, then shows them live on the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Add your warriors' })).toBeVisible();

  await page.getByPlaceholder('192.0.2.10:8001').fill(`${fakeWarrior()}\n`);
  await page.getByRole('button', { name: 'Add all' }).click();
  await expect(page.getByText(`Added (1)`)).toBeVisible();

  await page.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page.getByText('Live')).toBeVisible();

  const card = page.locator('article').first();
  await expect(card.getByText('Connected')).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Working on a project')).toBeVisible();
  await expect(card.getByText('uploader.jp')).toBeVisible();
  await expect(card.getByText('3 items running')).toBeVisible();
  await expect(card.getByText('1.00 kB/s')).toBeVisible();

  // Fleet summary reflects the one connected warrior.
  await expect(page.getByText('connected / enabled')).toBeVisible();
  await expect(page.locator('.stat-value').first()).toContainText('1');

  // Items expand to show their log.
  await card.locator('summary').first().click();
  await expect(card.locator('pre').first()).toContainText(/Starting|Finished|Received/);
});

test('warriors can be disabled and removed from the manage modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage warriors' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(fakeWarrior())).toBeVisible();

  await dialog.getByLabel('Enabled').uncheck();
  await expect(page.locator('article').first().getByText('Disabled')).toBeVisible({
    timeout: 10_000,
  });

  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog.getByText('No warriors configured.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('No warriors yet.')).toBeVisible();
});
