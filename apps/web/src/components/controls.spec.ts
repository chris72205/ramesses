import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WarriorCatalogProject, WarriorSnapshot } from '@ramesses/shared';
import { api, ApiError } from '../lib/api';
import { controls } from '../lib/controls.svelte';
import { fleet } from '../lib/fleet.svelte';
import { projects } from '../lib/projects.svelte';
import { summary, warriorOn } from '../test/project-fixtures';
import ConfirmDialog from './ConfirmDialog.svelte';
import ProjectPicker from './ProjectPicker.svelte';
import RunOnProjectDialog from './RunOnProjectDialog.svelte';
import Dashboard from './Dashboard.svelte';
import StopAllDialog from './StopAllDialog.svelte';
import WarriorCard from './WarriorCard.svelte';
import WarriorSettingsDialog from './WarriorSettingsDialog.svelte';
import { createRawSnippet } from 'svelte';

const NOW = 1_700_000_000_000;
const accepted = {
  id: 'w1',
  command: 'select_project' as const,
  acceptedAt: '2026-01-01T00:00:00Z',
};

function entry(name: string, title: string, extra: Partial<WarriorCatalogProject> = {}) {
  return { name, title, description: '', logo: '', leaderboard: '', repository: '', ...extra };
}

const catalog: Record<string, WarriorCatalogProject> = {
  auto: entry('auto', "ArchiveTeam's Choice"),
  telegram: entry('telegram', 'Telegram', { logo: 'https://example.org/t.png' }),
  blogger: entry('blogger', 'Blogger', { description: 'Blogs' }),
  urlteam2: entry('urlteam2', 'URLTeam 2'),
};

function snapshot(overrides: Partial<WarriorSnapshot> = {}): WarriorSnapshot {
  return {
    id: 'w1',
    name: 'warrior-1',
    host: '192.0.2.10',
    port: 8001,
    enabled: true,
    connection: {
      state: 'connected',
      lastSeenAt: NOW,
      connectedAt: NOW,
      lastError: null,
      attempts: 0,
    },
    instanceId: '1',
    status: 'RUNNING_PROJECT',
    runnerStatus: 'running',
    project: { title: 'Telegram', name: 'telegram', logo: null, leaderboard: null, deadline: null },
    items: [],
    bandwidth: null,
    bandwidthHistory: [],
    counters: { completed: 0, failed: 0, canceled: 0 },
    broadcastMessage: null,
    catalog,
    rolling: null,
    updatedAt: NOW,
    ...overrides,
  };
}

const body = createRawSnippet(() => ({ render: () => '<p>Body text</p>' }));

beforeEach(() => {
  controls.pending = {};
  controls.errors = {};
  vi.spyOn(api, 'selectProject').mockResolvedValue(accepted);
  vi.spyOn(api, 'deselectProject').mockResolvedValue({ ...accepted, command: 'deselect_project' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConfirmDialog', () => {
  it('renders an open dialog with the title, body, and buttons', async () => {
    const onconfirm = vi.fn();
    const oncancel = vi.fn();
    render(ConfirmDialog, {
      title: 'Sure?',
      confirmLabel: 'Do it',
      onconfirm,
      oncancel,
      children: body,
    });
    const dialog = screen.getByRole('dialog', { name: 'Sure?' });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByText('Body text')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(onconfirm).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(oncancel).toHaveBeenCalledOnce();
    // Escape asks the parent to close instead of closing the native dialog.
    await fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(oncancel).toHaveBeenCalledTimes(2);
  });

  it('disables the buttons while busy and hides cancel when asked', async () => {
    const oncancel = vi.fn();
    const { rerender } = render(ConfirmDialog, {
      title: 'Busy',
      busy: true,
      onconfirm: vi.fn(),
      oncancel,
      children: body,
    });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(oncancel).not.toHaveBeenCalled();

    await rerender({
      title: 'Busy',
      cancelLabel: null,
      disabled: true,
      onconfirm: vi.fn(),
      oncancel,
      children: body,
    });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  describe('backdrop clicks', () => {
    function open(busy = false) {
      const oncancel = vi.fn();
      render(ConfirmDialog, { title: 'Sure?', busy, onconfirm: vi.fn(), oncancel, children: body });
      return {
        oncancel,
        dialog: screen.getByRole('dialog'),
        inside: screen.getByText('Body text'),
      };
    }

    it('cancels on a click on the backdrop', async () => {
      const { oncancel, dialog } = open();
      await fireEvent.pointerDown(dialog);
      await fireEvent.click(dialog);
      expect(oncancel).toHaveBeenCalledOnce();
    });

    it('ignores a click inside the box', async () => {
      const { oncancel, inside } = open();
      await fireEvent.pointerDown(inside);
      await fireEvent.click(inside);
      expect(oncancel).not.toHaveBeenCalled();
    });

    it('ignores a drag that starts inside the box and ends on the backdrop', async () => {
      const { oncancel, dialog, inside } = open();
      await fireEvent.pointerDown(inside);
      await fireEvent.click(dialog);
      expect(oncancel).not.toHaveBeenCalled();
    });

    it('stays open while a request is in flight', async () => {
      const { oncancel, dialog } = open(true);
      await fireEvent.pointerDown(dialog);
      await fireEvent.click(dialog);
      expect(oncancel).not.toHaveBeenCalled();
    });
  });
});

describe('ProjectPicker', () => {
  it('lists the catalog without auto, sorted by title, marking the current project', () => {
    render(ProjectPicker, { catalog, current: 'telegram' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      'blogger',
      'telegram',
      'urlteam2',
    ]);
    expect(screen.getByText('current').closest('label')).toHaveTextContent('Telegram');
    expect(screen.getByText('Blogs')).toBeInTheDocument();
  });

  it('filters by title or key', async () => {
    render(ProjectPicker, { catalog });
    await fireEvent.input(screen.getByLabelText('Filter projects'), { target: { value: 'url' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    await fireEvent.input(screen.getByLabelText('Filter projects'), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('No project matches.')).toBeInTheDocument();
  });

  it('explains an empty catalog', () => {
    render(ProjectPicker, { catalog: {} });
    expect(screen.getByText(/has not loaded its project list/)).toBeInTheDocument();
  });

  describe('with tracker stats', () => {
    const rowOf = (name: string) =>
      screen.getByRole('radio', { name: new RegExp(name) }).closest('li') as HTMLElement;
    const radioValues = () =>
      screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value);

    beforeEach(() => {
      fleet.warriors = {};
      projects.items = [
        summary({ name: 'blogger', title: 'Blogger' }),
        summary({
          name: 'telegram',
          title: 'Telegram',
          doneRate: { h1: null, h6: null, h24: 900_000 },
          health: 'drained',
        }),
        summary({ name: 'urlteam2', title: 'URLTeam 2', tracker: 'terroroftinytown' }),
      ];
    });

    afterEach(() => {
      fleet.warriors = {};
      projects.items = [];
    });

    it('shows the rate, queue health, and to do count', () => {
      render(ProjectPicker, { catalog });
      const row = within(rowOf('Blogger'));
      expect(row.getByText('437K/h')).toBeInTheDocument();
      expect(row.getByText('Healthy')).toBeInTheDocument();
      expect(row.getByText('340')).toBeInTheDocument();
      expect(rowOf('Blogger')).toHaveTextContent('to do');
    });

    it('labels the rate when it falls back to the last day', () => {
      render(ProjectPicker, { catalog });
      expect(rowOf('Telegram')).toHaveTextContent('900K/h (24 h)');
      expect(rowOf('Blogger')).not.toHaveTextContent('(24 h)');
    });

    it('notes a project on another tracker and shows nothing for an unknown one', () => {
      projects.items = projects.items.filter((p) => p.name !== 'blogger');
      render(ProjectPicker, { catalog });
      expect(within(rowOf('URLTeam 2')).getByText('Stats unavailable')).toBeInTheDocument();
      expect(rowOf('Blogger')).not.toHaveTextContent('/h');
      expect(rowOf('Blogger')).not.toHaveTextContent('to do');
      expect(rowOf('Blogger')).not.toHaveTextContent('Stats unavailable');
    });

    it('counts your warriors only where some are running', () => {
      fleet.warriors = {
        a: warriorOn('a', 'blogger'),
        b: warriorOn('b', 'blogger'),
      };
      render(ProjectPicker, { catalog });
      expect(rowOf('Blogger')).toHaveTextContent('2 of your warriors');
      expect(rowOf('Telegram')).not.toHaveTextContent('of your warriors');
    });

    it('offers the whole description on hover', () => {
      render(ProjectPicker, { catalog });
      expect(screen.getByText('Blogs')).toHaveAttribute('title', 'Blogs');
    });

    it('expands one description at a time without selecting the project', async () => {
      const twoDescriptions = {
        ...catalog,
        telegram: entry('telegram', 'Telegram', { description: 'Channels' }),
      };
      render(ProjectPicker, { catalog: twoDescriptions });
      const blogs = screen.getByText('Blogs');
      const channels = screen.getByText('Channels');
      expect(blogs).toHaveClass('truncate');

      const showBlogs = screen.getByRole('button', {
        name: 'Show full description of Blogger',
        hidden: true,
      });
      await fireEvent.click(showBlogs);
      expect(showBlogs).toHaveAttribute('aria-expanded', 'true');
      expect(blogs).not.toHaveClass('truncate');
      expect(screen.getByRole('radio', { name: /Blogger/ })).not.toBeChecked();

      await fireEvent.click(
        screen.getByRole('button', { name: 'Show full description of Telegram', hidden: true }),
      );
      expect(blogs).toHaveClass('truncate');
      expect(channels).not.toHaveClass('truncate');
    });

    it('has no expand button without a description', () => {
      render(ProjectPicker, { catalog });
      expect(
        screen.queryByRole('button', { name: /description of Telegram/, hidden: true }),
      ).not.toBeInTheDocument();
    });

    it('sorts by rate on request and keeps the filter applied', async () => {
      render(ProjectPicker, { catalog });
      expect(radioValues()).toEqual(['blogger', 'telegram', 'urlteam2']);
      expect(screen.getByRole('button', { name: 'Name' })).toHaveAttribute('aria-pressed', 'true');

      await fireEvent.click(screen.getByRole('button', { name: 'Rate' }));
      expect(screen.getByRole('button', { name: 'Rate' })).toHaveAttribute('aria-pressed', 'true');
      expect(radioValues()).toEqual(['telegram', 'blogger', 'urlteam2']);

      await fireEvent.input(screen.getByLabelText('Filter projects'), { target: { value: 'gr' } });
      expect(radioValues()).toEqual(['telegram']);
    });
  });
});

describe('WarriorCard actions', () => {
  it('offers all three actions to a live warrior with a project', () => {
    render(WarriorCard, { warrior: snapshot(), now: NOW });
    expect(screen.getByRole('button', { name: 'Actions for warrior-1' })).toBeEnabled();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual([
      'Change project…',
      'Stop working',
      'Settings…',
    ]);
  });

  it.each([
    ['idle', { project: null, status: 'NO_PROJECT' as const }],
    ['shutting down', { status: 'SHUTTING_DOWN' as const }],
    ['rebooting', { status: 'REBOOTING' as const }],
  ])('hides Stop working when %s', (_label, overrides) => {
    render(WarriorCard, { warrior: snapshot(overrides), now: NOW });
    expect(screen.queryByRole('menuitem', { name: 'Stop working' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Change project…' })).toBeInTheDocument();
  });

  it('has no menu for a disconnected or disabled warrior', () => {
    render(WarriorCard, {
      warrior: snapshot({ connection: { ...snapshot().connection, state: 'reconnecting' } }),
      now: NOW,
    });
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    render(WarriorCard, { warrior: snapshot({ enabled: false }), now: NOW });
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('switches project through the picker dialog', async () => {
    render(WarriorCard, { warrior: snapshot(), now: NOW });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Change project…' }));
    const dialog = screen.getByRole('dialog', { name: 'Change project for warrior-1' });
    const confirm = screen.getByRole('button', { name: 'Switch project' });
    expect(confirm).toBeDisabled();
    // Picking the current project is not a change.
    await fireEvent.click(screen.getByRole('radio', { name: /Telegram/ }));
    expect(confirm).toBeDisabled();
    await fireEvent.click(screen.getByRole('radio', { name: /Blogger/ }));
    expect(confirm).toBeEnabled();
    await fireEvent.click(confirm);
    expect(api.selectProject).toHaveBeenCalledWith('w1', 'blogger');
    expect(dialog).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Switching to Blogger…'),
    );
    expect(screen.getByRole('button', { name: 'Actions for warrior-1' })).toBeDisabled();
  });

  it('cancels the picker without a request', async () => {
    render(WarriorCard, { warrior: snapshot(), now: NOW });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Change project…' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.selectProject).not.toHaveBeenCalled();
  });

  it('stops work after confirmation and shows the pending line until idle', async () => {
    const { rerender } = render(WarriorCard, { warrior: snapshot(), now: NOW });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Stop working' }));
    expect(screen.getByRole('dialog', { name: 'Stop working on Telegram?' })).toBeInTheDocument();
    expect(screen.getByText(/Finishes the items in flight/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Stop working' }));
    expect(api.deselectProject).toHaveBeenCalledWith('w1');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Stopping work…'));

    await rerender({ warrior: snapshot({ status: 'STOPPING_PROJECT' }), now: NOW });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await rerender({ warrior: snapshot({ status: 'NO_PROJECT', project: null }), now: NOW });
    await tick();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the server error inline and lets it be dismissed', async () => {
    vi.mocked(api.deselectProject).mockRejectedValue(
      new ApiError(502, 'Could not reach warrior-1'),
    );
    render(WarriorCard, { warrior: snapshot(), now: NOW });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Stop working' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Stop working' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach warrior-1');
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens the settings dialog from the menu', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ downloader: 'chris', concurrentItems: 2 });
    render(WarriorCard, { warrior: snapshot(), now: NOW });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Settings…' }));
    expect(screen.getByRole('dialog', { name: 'Settings for warrior-1' })).toBeInTheDocument();
    expect(await screen.findByLabelText(/Nickname/)).toHaveValue('chris');
  });
});

describe('WarriorSettingsDialog', () => {
  it('loads the values, saves only what changed, and closes', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ downloader: 'chris', concurrentItems: 2 });
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValue({ ...accepted, command: 'update_settings' });
    const onclose = vi.fn();
    render(WarriorSettingsDialog, { warrior: snapshot(), onclose });
    expect(screen.getByRole('status', { name: 'Loading settings' })).toBeInTheDocument();
    const nickname = await screen.findByLabelText(/Nickname/);
    expect(nickname).toHaveValue('chris');
    expect(screen.getByLabelText(/Concurrent items/)).toHaveValue('2');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await fireEvent.change(screen.getByLabelText(/Concurrent items/), { target: { value: '4' } });
    expect(save).toBeEnabled();
    await fireEvent.click(save);
    await waitFor(() => expect(onclose).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith('w1', { concurrentItems: 4 });
  });

  it('shows the warrior rejection next to the field', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ downloader: 'chris', concurrentItems: 2 });
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiError(422, 'downloader: Invalid value for your nickname.', {
        downloader: 'Invalid value for your nickname.',
      }),
    );
    const onclose = vi.fn();
    render(WarriorSettingsDialog, { warrior: snapshot(), onclose });
    const nickname = await screen.findByLabelText(/Nickname/);
    await fireEvent.input(nickname, { target: { value: 'bad name' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Invalid value for your nickname.')).toBeInTheDocument();
    expect(nickname).toHaveAttribute('aria-invalid', 'true');
    expect(onclose).not.toHaveBeenCalled();
  });

  it('shows other save errors as an alert', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ downloader: null, concurrentItems: null });
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new ApiError(502, 'Could not reach it'));
    render(WarriorSettingsDialog, { warrior: snapshot(), onclose: vi.fn() });
    const nickname = await screen.findByLabelText(/Nickname/);
    expect(nickname).toHaveValue('');
    await fireEvent.input(nickname, { target: { value: 'newnick' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach it');
    expect(api.updateSettings).toHaveBeenCalledWith('w1', { downloader: 'newnick' });
  });

  it('offers a retry when the values cannot be read', async () => {
    const get = vi
      .spyOn(api, 'getSettings')
      .mockRejectedValueOnce(new ApiError(502, 'warrior requires credentials'))
      .mockResolvedValueOnce({ downloader: 'chris', concurrentItems: 3 });
    render(WarriorSettingsDialog, { warrior: snapshot(), onclose: vi.fn() });
    expect(await screen.findByRole('alert')).toHaveTextContent('warrior requires credentials');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText(/Nickname/)).toHaveValue('chris');
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('RunOnProjectDialog', () => {
  const project = { name: 'blogger', title: 'Blogger' };
  const warriors = [
    snapshot(),
    snapshot({
      id: 'w2',
      name: 'warrior-2',
      project: { title: 'Blogger', name: 'blogger', logo: null, leaderboard: null, deadline: null },
    }),
    snapshot({ id: 'w3', name: 'warrior-3', project: null, status: 'NO_PROJECT' }),
    snapshot({ id: 'w4', name: 'warrior-4', catalog: {} }),
    snapshot({
      id: 'w5',
      name: 'warrior-5',
      connection: { ...snapshot().connection, state: 'offline' },
    }),
  ];

  it('lists connected warriors with why each can or cannot switch', () => {
    render(RunOnProjectDialog, { project, warriors, onclose: vi.fn() });
    expect(screen.getByRole('dialog', { name: 'Run Blogger on…' })).toBeInTheDocument();
    expect(screen.getByLabelText('Run on warrior-1')).toBeEnabled();
    expect(screen.getByText('Now on Telegram')).toBeInTheDocument();
    expect(screen.getByLabelText('Run on warrior-2')).toBeDisabled();
    expect(screen.getByText('Already on this project')).toBeInTheDocument();
    expect(screen.getByLabelText('Run on warrior-3')).toBeEnabled();
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByLabelText('Run on warrior-4')).toBeDisabled();
    expect(screen.getByText(/Not in this warrior/)).toBeInTheDocument();
    expect(screen.queryByText('warrior-5')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run on 0 warriors' })).toBeDisabled();
  });

  it('sends one request per checked warrior and reports each result', async () => {
    vi.mocked(api.selectProject)
      .mockResolvedValueOnce(accepted)
      .mockRejectedValueOnce(new ApiError(409, 'warrior-3 is not being tracked yet'));
    const onclose = vi.fn();
    render(RunOnProjectDialog, { project, warriors, onclose });
    await fireEvent.click(screen.getByLabelText('Run on warrior-1'));
    expect(screen.getByRole('button', { name: 'Run on 1 warrior' })).toBeEnabled();
    await fireEvent.click(screen.getByLabelText('Run on warrior-3'));
    await fireEvent.click(screen.getByRole('button', { name: 'Run on 2 warriors' }));

    expect(await screen.findByText('accepted')).toBeInTheDocument();
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(screen.getByText('warrior-3 is not being tracked yet')).toBeInTheDocument();
    expect(api.selectProject).toHaveBeenNthCalledWith(1, 'w1', 'blogger');
    expect(api.selectProject).toHaveBeenNthCalledWith(2, 'w3', 'blogger');
    expect(controls.pending['w1']?.label).toBe('Switching to Blogger…');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('says when nothing is connected', () => {
    render(RunOnProjectDialog, { project, warriors: [warriors[4]!], onclose: vi.fn() });
    expect(screen.getByText(/No warrior is connected/)).toBeInTheDocument();
  });
});

describe('StopAllDialog', () => {
  const warriors = [
    snapshot(),
    snapshot({ id: 'w2', name: 'warrior-2', status: 'STOPPING_PROJECT' }),
    snapshot({ id: 'w3', name: 'warrior-3', project: null, status: 'NO_PROJECT' }),
    snapshot({ id: 'w4', name: 'warrior-4', status: 'REBOOTING' }),
    snapshot({
      id: 'w5',
      name: 'warrior-5',
      connection: { ...snapshot().connection, state: 'offline' },
    }),
  ];

  it('lists working warriors, checked by default, and skips idle or offline ones', () => {
    render(StopAllDialog, { warriors, onclose: vi.fn() });
    expect(screen.getByRole('dialog', { name: 'Stop all warriors' })).toBeInTheDocument();
    expect(screen.getByLabelText('Stop warrior-1')).toBeChecked();
    expect(screen.getByText('Now on Telegram')).toBeInTheDocument();
    expect(screen.getByLabelText('Stop warrior-2')).toBeDisabled();
    expect(screen.getByText('Already stopping')).toBeInTheDocument();
    expect(screen.getByLabelText('Stop warrior-4')).toBeDisabled();
    expect(screen.getByText('Rebooting')).toBeInTheDocument();
    expect(screen.queryByText('warrior-3')).not.toBeInTheDocument();
    expect(screen.queryByText('warrior-5')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop 1 warrior' })).toBeEnabled();
    expect(screen.getByText(/Nothing is shut down/)).toBeInTheDocument();
  });

  it('deselects each checked warrior in turn and reports the outcome', async () => {
    const onclose = vi.fn();
    render(StopAllDialog, {
      warriors: [warriors[0]!, snapshot({ id: 'w6', name: 'warrior-6' })],
      onclose,
    });
    await fireEvent.click(screen.getByLabelText('Stop warrior-6'));
    await fireEvent.click(screen.getByRole('button', { name: 'Stop 1 warrior' }));
    expect(await screen.findByText('accepted')).toBeInTheDocument();
    expect(api.deselectProject).toHaveBeenCalledTimes(1);
    expect(api.deselectProject).toHaveBeenCalledWith('w1');
    expect(controls.pending['w1']?.label).toBe('Stopping work…');
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('says when nothing is working', () => {
    render(StopAllDialog, { warriors: [warriors[2]!], onclose: vi.fn() });
    expect(screen.getByText(/No connected warrior is working/)).toBeInTheDocument();
  });
});

describe('Dashboard stop all', () => {
  it('offers Stop all only while a connected warrior has a project', async () => {
    fleet.ready = true;
    fleet.warriors = {
      w3: snapshot({ id: 'w3', name: 'warrior-3', project: null, status: 'NO_PROJECT' }),
    };
    const first = render(Dashboard);
    expect(screen.getByRole('button', { name: 'Stop all…' })).toBeDisabled();
    first.unmount();

    fleet.warriors = { w1: snapshot() };
    render(Dashboard);
    const button = screen.getByRole('button', { name: 'Stop all…' });
    expect(button).toBeEnabled();
    await fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Stop all warriors' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fleet.warriors = {};
  });
});
