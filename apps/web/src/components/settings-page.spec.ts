import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { warriors } from '../lib/warriors.svelte';
import SettingsPage from './SettingsPage.svelte';

const mocks = vi.hoisted(() => ({
  listWarriors: vi.fn(),
  updateWarrior: vi.fn(),
  deleteWarrior: vi.fn(),
  createWarrior: vi.fn(),
}));
vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, ...mocks } };
});

const record = {
  id: '1',
  name: 'alpha',
  host: 'h',
  port: 8001,
  enabled: true,
  createdAt: '',
  updatedAt: '',
};

describe('SettingsPage', () => {
  beforeEach(() => {
    warriors.records = [record];
    warriors.error = null;
  });
  afterEach(() => {
    mocks.listWarriors.mockReset();
    mocks.updateWarrior.mockReset();
  });

  it('shows the warrior list and reloads it after a change', async () => {
    mocks.updateWarrior.mockResolvedValueOnce({ ...record, enabled: false });
    mocks.listWarriors.mockResolvedValueOnce([{ ...record, enabled: false }]);
    render(SettingsPage);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warriors' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /^alpha\b/ })).toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText('Enabled'));
    await waitFor(() => expect(mocks.listWarriors).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Enabled')).not.toBeChecked());
  });

  it('reports a load error with a retry', async () => {
    warriors.error = 'ECONNREFUSED';
    mocks.listWarriors.mockResolvedValueOnce([record]);
    render(SettingsPage);
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load warriors: ECONNREFUSED/);
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('cell', { name: /^alpha\b/ })).toBeInTheDocument();
  });
});
