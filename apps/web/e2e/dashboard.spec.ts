import { expect, test } from '@playwright/test';

const fakeWarrior = () => `127.0.0.1:${process.env.FAKE_WARRIOR_PORT}`;

test.describe.configure({ mode: 'serial' });

test('first run asks for warriors, then shows them live on the dashboard', async ({ page }) => {
  await page.goto('/');
  // The manage modal renders the same form (closed) outside <main>, so scope to the setup view.
  const setup = page.locator('main');
  await expect(setup.getByRole('heading', { name: 'Add your warriors' })).toBeVisible();

  await setup.getByPlaceholder('192.0.2.10:8001').fill(`${fakeWarrior()}\n`);
  await setup.getByRole('button', { name: 'Add all' }).click();
  await expect(setup.getByText(`Added (1)`)).toBeVisible();

  await setup.getByRole('button', { name: 'Open dashboard' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

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

test('warriors can be disabled and removed from the settings page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const settings = page.locator('main');
  await expect(settings.getByRole('heading', { name: 'Warriors' })).toBeVisible();
  // The unnamed warrior's name defaults to its address, so match the row rather than the text.
  await expect(settings.getByRole('row').filter({ hasText: fakeWarrior() })).toBeVisible();

  await settings.getByLabel('Enabled').uncheck();
  await expect(settings.getByLabel('Enabled')).not.toBeChecked();
  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await expect(page.locator('article').first().getByText('Disabled', { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // A deep link to settings survives a reload.
  await page.goto('/settings');
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await settings.getByRole('button', { name: 'Delete' }).click();
  // With no warriors left the app returns to first-run setup.
  await expect(page.getByRole('heading', { name: 'Add your warriors' })).toBeVisible();
});
