import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WarriorRecord } from '@ramesses/shared';
import { ApiError } from '../lib/api';
import type * as ApiModule from '../lib/api';
import { notifications } from '../lib/notifications.svelte';
import AddWarriorsForm from './AddWarriorsForm.svelte';
import SetupView from './SetupView.svelte';
import SocketBadge from './SocketBadge.svelte';
import WarriorsManager from './WarriorsManager.svelte';

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

afterEach(() => {
  vi.clearAllMocks();
  notifications.clear();
});

const messages = () => notifications.items.map((n) => `${n.level}: ${n.message}`);

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
    expect(messages()).toEqual(['success: Added 1 warrior']);
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
    expect(messages()).toEqual(['success: Added 2 warriors']);
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
    await waitFor(() => expect(onchange).toHaveBeenCalled());
    expect(messages()).toEqual(['success: w-1 removed']);
    await fireEvent.click(screen.getByRole('button', { name: 'Open dashboard' }));
    expect(ondone).toHaveBeenCalled();
  });

  it('hides the list until something was added', () => {
    render(SetupView, { records: [], onchange: vi.fn(), ondone: vi.fn() });
    expect(screen.queryByText(/Added/)).not.toBeInTheDocument();
  });

  it('reports a failed removal', async () => {
    mocks.deleteWarrior.mockRejectedValueOnce(new ApiError(502, 'nope'));
    const onchange = vi.fn();
    render(SetupView, { records: [record('1')], onchange, ondone: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(messages()).toEqual(['error: w-1: nope']));
    expect(onchange).not.toHaveBeenCalled();
  });
});

describe('WarriorsManager', () => {
  it('toggles and deletes warriors through the API', async () => {
    const onchange = vi.fn();
    render(WarriorsManager, { records: [record('1')], onchange });
    expect(screen.getByText('w-1')).toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText('Enabled'));
    await waitFor(() => expect(mocks.updateWarrior).toHaveBeenCalledWith('1', { enabled: false }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deleteWarrior).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(onchange).toHaveBeenCalledTimes(2));
    expect(messages()).toEqual(['success: w-1 disabled', 'success: w-1 deleted']);
  });

  it('repeats the address under the name only when the name differs', () => {
    const first = render(WarriorsManager, { records: [record('1')], onchange: vi.fn() });
    // Named warrior: the address appears in its own column and again in the phone-only line.
    expect(screen.getAllByText('10.0.0.1:8001')).toHaveLength(2);
    first.unmount();
    render(WarriorsManager, {
      records: [record('2', { name: '10.0.0.1:8001' })],
      onchange: vi.fn(),
    });
    // Unnamed warrior: name cell plus the address column, no third copy.
    expect(screen.getAllByText('10.0.0.1:8001')).toHaveLength(2);
  });

  it('reports API errors as toasts and shows an empty state', async () => {
    mocks.deleteWarrior.mockRejectedValueOnce(new Error('nope'));
    const onchange = vi.fn();
    const first = render(WarriorsManager, { records: [record('1')], onchange });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(messages()).toEqual(['error: w-1: nope']));
    expect(onchange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    first.unmount();
    render(WarriorsManager, { records: [], onchange: vi.fn() });
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
