import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WarriorRecord } from '@ramesses/shared';
import { ApiError } from '../lib/api';
import type * as ApiModule from '../lib/api';
import AddWarriorsForm from './AddWarriorsForm.svelte';
import SetupView from './SetupView.svelte';
import SocketBadge from './SocketBadge.svelte';
import WarriorsModal from './WarriorsModal.svelte';

const mocks = vi.hoisted(() => ({
  createWarrior: vi.fn(),
  updateWarrior: vi.fn(),
  deleteWarrior: vi.fn(),
  listWarriors: vi.fn(),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: mocks };
});

const record = (id: string, extra: Partial<WarriorRecord> = {}): WarriorRecord => ({
  id,
  name: `w-${id}`,
  host: '10.0.0.1',
  port: 8001,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

beforeEach(() => {
  mocks.createWarrior
    .mockReset()
    .mockImplementation(async (input: { host: string }) => record(input.host));
  mocks.updateWarrior.mockReset().mockResolvedValue(record('1'));
  mocks.deleteWarrior.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('AddWarriorsForm', () => {
  it('adds a single warrior and clears the fields', async () => {
    const onadded = vi.fn();
    render(AddWarriorsForm, { onadded });
    const host = screen.getByPlaceholderText('192.0.2.10');
    await fireEvent.input(host, { target: { value: ' 192.0.2.10 ' } });
    await fireEvent.input(screen.getByPlaceholderText('8001'), { target: { value: '8003' } });
    await fireEvent.input(screen.getByPlaceholderText('warrior-1'), { target: { value: 'three' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onadded).toHaveBeenCalled());
    expect(mocks.createWarrior).toHaveBeenCalledWith({
      host: '192.0.2.10',
      port: 8003,
      name: 'three',
    });
    expect((host as HTMLInputElement).value).toBe('');
  });

  it('adds every line of the bulk box and reports per-line failures', async () => {
    mocks.createWarrior.mockImplementation(async (input: { host: string; port?: number }) => {
      if (input.port === 2) throw new ApiError(409, 'already exists');
      return record(input.host);
    });
    const onadded = vi.fn();
    render(AddWarriorsForm, { onadded });
    const box = screen.getByPlaceholderText(/192\.0\.2\.10:8001/);
    await fireEvent.input(box, { target: { value: 'a:1\n\nb:2\nc' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add all' }));
    await waitFor(() => expect(mocks.createWarrior).toHaveBeenCalledTimes(3));
    expect(onadded).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('b:2: already exists')).toBeInTheDocument();
    expect((box as HTMLTextAreaElement).value).toContain('b:2');
  });

  it('ignores an empty bulk submission', async () => {
    render(AddWarriorsForm, { onadded: vi.fn() });
    const box = screen.getByPlaceholderText(/192\.0\.2\.10:8001/);
    await fireEvent.input(box, { target: { value: '   \n ' } });
    await fireEvent.submit(box.closest('form')!);
    expect(mocks.createWarrior).not.toHaveBeenCalled();
  });
});

describe('SetupView', () => {
  it('lists added warriors, removes one, and opens the dashboard', async () => {
    const onchange = vi.fn();
    const ondone = vi.fn();
    render(SetupView, { records: [record('1'), record('2')], onchange, ondone });
    expect(screen.getByText('Added (2)')).toBeInTheDocument();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await waitFor(() => expect(mocks.deleteWarrior).toHaveBeenCalledWith('1'));
    expect(onchange).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Open dashboard' }));
    expect(ondone).toHaveBeenCalled();
  });

  it('hides the list until something was added', () => {
    render(SetupView, { records: [], onchange: vi.fn(), ondone: vi.fn() });
    expect(screen.queryByText(/Added/)).not.toBeInTheDocument();
  });
});

describe('WarriorsModal', () => {
  beforeEach(() => {
    // jsdom does not implement <dialog> methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('toggles and deletes warriors through the API', async () => {
    const onchange = vi.fn();
    render(WarriorsModal, { open: true, records: [record('1')], onclose: vi.fn(), onchange });
    expect(screen.getByText('w-1')).toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText('Enabled'));
    await waitFor(() => expect(mocks.updateWarrior).toHaveBeenCalledWith('1', { enabled: false }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deleteWarrior).toHaveBeenCalledWith('1'));
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it('shows API errors and an empty state', async () => {
    mocks.deleteWarrior.mockRejectedValueOnce(new Error('nope'));
    render(WarriorsModal, {
      open: true,
      records: [record('1')],
      onclose: vi.fn(),
      onchange: vi.fn(),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('nope')).toBeInTheDocument();
    render(WarriorsModal, { open: false, records: [], onclose: vi.fn(), onchange: vi.fn() });
    expect(screen.getByText('No warriors configured.')).toBeInTheDocument();
  });
});

describe('SocketBadge', () => {
  it.each([
    ['open', 'Live'],
    ['reconnecting', 'Reconnecting'],
    ['connecting', 'Connecting'],
  ] as const)('renders %s', (state, text) => {
    render(SocketBadge, { state });
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
