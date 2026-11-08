import { expect, test, type Page } from '@playwright/test';
import { FakeWarrior } from '../../server/test/support/fake-warrior';
import { BACKEND_PORT } from '../playwright.config';

const fakeWarrior = () => `127.0.0.1:${process.env.FAKE_WARRIOR_PORT}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  // Earlier suites may have ended with no warriors, which sends the app back to first-run setup.
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

async function openActions(page: Page) {
  const card = page.locator('article').first();
  await expect(card.getByText('Connected')).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: /^Actions for/ }).click();
  return card;
}

test('a project can be changed from the card', async ({ page }) => {
  await page.goto('/');
  const card = await openActions(page);
  await card.getByRole('menuitem', { name: 'Change project…' }).click();

  const dialog = page.getByRole('dialog', { name: /Change project for/ });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Switch project' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('radio', { name: /Telegram/ }).check();
  await confirm.click();

  await expect(dialog).toBeHidden();
  await expect(card.getByRole('status')).toHaveText(/Switching to Telegram/);
  await expect(card.getByRole('link', { name: 'Telegram' })).toBeVisible();
  // The fake warrior reports the new project running shortly after, which clears the line.
  await expect(card.getByRole('status')).toBeHidden({ timeout: 10_000 });
  await expect(card.getByText('Working on a project')).toBeVisible();
});

test('stop working drains the project and leaves the warrior idle', async ({ page }) => {
  await page.goto('/');
  const card = await openActions(page);
  await card.getByRole('menuitem', { name: 'Stop working' }).click();

  const dialog = page.getByRole('dialog', { name: /Stop working on Telegram/ });
  await expect(dialog.getByText(/Finishes the items in flight/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop working' }).click();

  await expect(card.getByRole('status')).toHaveText(/Stopping work/);
  await expect(card.getByText('No project selected.')).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText('Idle, no project selected')).toBeVisible();
  await expect(card.getByRole('status')).toBeHidden();

  // An idle warrior has nothing to stop.
  await card.getByRole('button', { name: /^Actions for/ }).click();
  await expect(card.getByRole('menuitem', { name: 'Stop working' })).toBeHidden();
  await expect(card.getByRole('menuitem', { name: 'Change project…' })).toBeVisible();
});

test('settings are read from the warrior, validated, and saved', async ({ page }) => {
  await page.goto('/');
  const card = await openActions(page);
  await card.getByRole('menuitem', { name: 'Settings…' }).click();

  const dialog = page.getByRole('dialog', { name: /Settings for/ });
  const nickname = dialog.getByLabel('Nickname');
  await expect(nickname).toHaveValue('fake');
  await expect(dialog.getByLabel('Concurrent items')).toHaveValue('2');
  const save = dialog.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  // Too short for the tracker: the backend rejects it before the warrior sees it.
  await nickname.fill('ab');
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText(/downloader/);

  await nickname.fill('playwright-nick');
  await dialog.getByLabel('Concurrent items').selectOption('3');
  await save.click();
  await expect(dialog).toBeHidden();

  await card.getByRole('button', { name: /^Actions for/ }).click();
  await card.getByRole('menuitem', { name: 'Settings…' }).click();
  await expect(dialog.getByLabel('Nickname')).toHaveValue('playwright-nick');
  await expect(dialog.getByLabel('Concurrent items')).toHaveValue('3');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('a project page can put warriors onto its project', async ({ page }) => {
  await page.goto('/projects/telegram');
  await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible({ timeout: 20_000 });
  const mine = page.getByRole('region', { name: /Your warriors on this project/ });
  await expect(mine.getByText(/None of your warriors/)).toBeVisible();

  await mine.getByRole('button', { name: 'Run on this project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Run Telegram on…' });
  await expect(dialog.getByText('Idle')).toBeVisible();
  const run = dialog.getByRole('button', { name: /^Run on/ });
  await expect(run).toBeDisabled();
  await dialog.getByLabel(`Run on ${fakeWarrior()}`).check();
  await expect(run).toHaveText('Run on 1 warrior');
  await run.click();

  await expect(dialog.getByText('accepted')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(mine.getByRole('link', { name: fakeWarrior() })).toBeVisible({ timeout: 15_000 });
});

test.describe('stop all', () => {
  let second: FakeWarrior | undefined;

  test.afterAll(async ({ request }) => {
    await second?.stop();
    const all = (await (
      await request.get(`http://localhost:${BACKEND_PORT}/api/warriors`)
    ).json()) as Array<{ id: string; name: string }>;
    for (const w of all) {
      if (w.name === 'warrior-two') {
        await request.delete(`http://localhost:${BACKEND_PORT}/api/warriors/${w.id}`);
      }
    }
  });

  test('idles every warrior that has a project', async ({ page, request }) => {
    // The first fake is on Telegram from the project page test; the second starts on uploader.jp.
    second = await new FakeWarrior({ tickMs: 250 }).start();
    second.reactToCommands();
    await request.post(`http://localhost:${BACKEND_PORT}/api/warriors`, {
      data: { host: '127.0.0.1', port: second.port, name: 'warrior-two' },
    });

    await page.goto('/');
    const cards = page.locator('article');
    await expect(cards).toHaveCount(2);
    await expect(cards.getByText('Connected')).toHaveCount(2, { timeout: 15_000 });
    await expect(cards.getByText('Working on a project')).toHaveCount(2);

    await page.getByRole('button', { name: 'Stop all…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop all warriors' });
    await expect(dialog.getByRole('checkbox')).toHaveCount(2);
    await expect(dialog.getByLabel('Stop warrior-two')).toBeChecked();
    await dialog.getByRole('button', { name: 'Stop 2 warriors' }).click();
    await expect(dialog.getByText('accepted')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await expect(cards.getByText('No project selected.')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Stop all…' })).toBeDisabled();
  });
});
