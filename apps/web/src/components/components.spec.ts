import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ItemSnapshot, WarriorSnapshot } from '@ramesses/shared';
import ConnectionBadge from './ConnectionBadge.svelte';
import FleetSummary from './FleetSummary.svelte';
import ItemRow from './ItemRow.svelte';
import TaskProgress from './TaskProgress.svelte';
import WarriorCard from './WarriorCard.svelte';

const NOW = 1_700_000_000_000;

const item: ItemSnapshot = {
  id: 'i1',
  number: 7,
  name: 'Item post:channel:1\u0000post:channel:2',
  status: 'running',
  tasks: [
    { id: 1, name: 'CheckIP', status: 'completed' },
    { id: 2, name: 'WgetDownload', status: 'running' },
    { id: 3, name: 'Upload', status: null },
  ],
  logTail: 'Starting CheckIP\nFinished CheckIP',
  startTime: (NOW - 65_000) / 1000,
  finishedAt: null,
};

const warrior: WarriorSnapshot = {
  id: 'w1',
  name: 'warrior-1',
  host: '192.0.2.10',
  port: 8002,
  enabled: true,
  connection: {
    state: 'connected',
    lastSeenAt: NOW,
    connectedAt: NOW - 5000,
    lastError: null,
    attempts: 0,
  },
  instanceId: '1',
  status: 'RUNNING_PROJECT',
  runnerStatus: 'running',
  project: {
    title: 'Telegram',
    name: 'telegram',
    logo: 'https://example.org/logo.png',
    leaderboard: 'https://example.org/lb',
    deadline: null,
  },
  items: [item],
  bandwidth: {
    at: NOW,
    received: 310_100_000,
    sent: 25_800_000,
    receiving: 45_500,
    sending: 4_000,
  },
  bandwidthHistory: [
    { at: NOW - 1000, received: 1, sent: 1, receiving: 10, sending: 5 },
    { at: NOW, received: 2, sent: 2, receiving: 45_500, sending: 4_000 },
  ],
  counters: { completed: 3, failed: 1, canceled: 0 },
  broadcastMessage: null,
  catalog: {},
  rolling: {
    windowMs: 300_000,
    samples: 120,
    avgReceiving: 20_000,
    avgSending: 1_500,
    peakReceiving: 90_000,
    peakSending: 9_000,
  },
  updatedAt: NOW,
};

describe('TaskProgress', () => {
  it('shows completed count and the running task', () => {
    render(TaskProgress, { tasks: item.tasks });
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('WgetDownload')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
  });

  it('turns red when a task failed', () => {
    const { container } = render(TaskProgress, { tasks: [{ id: 1, name: 'x', status: 'failed' }] });
    expect(container.querySelector('progress')).toHaveClass('progress-error');
  });
});

describe('ConnectionBadge', () => {
  it.each([
    ['connected', 'Connected'],
    ['connecting', 'Connecting'],
    ['offline', 'Offline'],
  ] as const)('renders %s', (state, text) => {
    render(ConnectionBadge, {
      connection: { ...warrior.connection, state },
      enabled: true,
      now: NOW,
    });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows attempts while reconnecting and the last error in the title', () => {
    render(ConnectionBadge, {
      connection: {
        ...warrior.connection,
        state: 'reconnecting',
        attempts: 3,
        lastError: 'refused',
      },
      enabled: true,
      now: NOW,
    });
    const badge = screen.getByText('Reconnecting (3)');
    expect(badge.closest('span[title]')?.getAttribute('title')).toContain('refused');
  });

  it('shows Disabled regardless of connection state', () => {
    render(ConnectionBadge, { connection: warrior.connection, enabled: false, now: NOW });
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});

describe('ItemRow', () => {
  it('renders number, cleaned name, elapsed time, and log', () => {
    render(ItemRow, { item, now: NOW });
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('post:channel:1 · post:channel:2')).toBeInTheDocument();
    expect(screen.getByText('1m 05s')).toBeInTheDocument();
    expect(screen.getByText(/Finished CheckIP/)).toBeInTheDocument();
  });

  it('shows a status badge for finished items', () => {
    render(ItemRow, { item: { ...item, status: 'failed', finishedAt: NOW }, now: NOW });
    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});

describe('FleetSummary', () => {
  it('renders totals', () => {
    render(FleetSummary, {
      totals: {
        warriors: 6,
        enabled: 5,
        connected: 4,
        receiving: 1234,
        sending: 10,
        received: 5e9,
        sent: 1e6,
        itemsInFlight: 12,
        completed: 30,
        failed: 2,
        projects: ['Telegram', 'URLs'],
        rollingWindowMs: 300_000,
        avgReceiving: 2_000,
        avgSending: 100,
      },
    });
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('/ 5')).toBeInTheDocument();
    expect(screen.getByText('1.23 kB/s')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Telegram, URLs')).toBeInTheDocument();
    expect(screen.getByText(/1 disabled/)).toBeInTheDocument();
    expect(screen.getByText(/5 min avg 2\.00 kB\/s/)).toBeInTheDocument();
  });
});

describe('WarriorCard', () => {
  it('renders a connected warrior with project, bandwidth, and items', () => {
    render(WarriorCard, { warrior, now: NOW });
    expect(screen.getByText('warrior-1')).toBeInTheDocument();
    const hostLink = screen.getByRole('link', { name: '192.0.2.10:8002' });
    expect(hostLink).toHaveAttribute('href', 'http://192.0.2.10:8002/');
    expect(hostLink).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Working on a project')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Telegram' })).toHaveAttribute(
      'href',
      '/projects/telegram',
    );
    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute(
      'href',
      'https://example.org/lb',
    );
    expect(screen.getByText('45.5 kB/s')).toBeInTheDocument();
    expect(screen.getByText('310 MB')).toBeInTheDocument();
    expect(screen.getByText('1 item running')).toBeInTheDocument();
    expect(screen.getByText(/3 completed · 1 failed/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Bandwidth over the last 2 s/ })).toBeInTheDocument();
  });

  it('dims and explains a reconnecting warrior', () => {
    const { container } = render(WarriorCard, {
      warrior: {
        ...warrior,
        connection: {
          ...warrior.connection,
          state: 'reconnecting',
          lastError: 'connection failed or dropped',
          attempts: 2,
        },
      },
      now: NOW,
    });
    expect(container.querySelector('article')).toHaveClass('opacity-70');
    expect(screen.getByText(/connection failed or dropped/)).toBeInTheDocument();
  });

  it('explains a disabled warrior', () => {
    render(WarriorCard, { warrior: { ...warrior, enabled: false }, now: NOW });
    expect(screen.getByText(/Disabled\. Enable it/)).toBeInTheDocument();
  });

  it('shows the project title as plain text when it is not in the catalog', () => {
    render(WarriorCard, {
      warrior: { ...warrior, project: { ...warrior.project!, name: null } },
      now: NOW,
    });
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Telegram' })).not.toBeInTheDocument();
  });

  it('shows "No project selected" for an idle connected warrior', () => {
    render(WarriorCard, {
      warrior: { ...warrior, project: null, items: [], status: 'NO_PROJECT' },
      now: NOW,
    });
    expect(screen.getByText('No project selected.')).toBeInTheDocument();
    expect(screen.getByText('Idle, no project selected')).toBeInTheDocument();
  });
});
