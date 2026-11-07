import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ItemSnapshot, WarriorSnapshot } from '@ramesses/shared';
import { fleet } from '../lib/fleet.svelte';
import { formatAgo, formatBytes } from '../lib/format';
import Dashboard from './Dashboard.svelte';
import FleetSummary from './FleetSummary.svelte';
import ItemRow from './ItemRow.svelte';
import TaskProgress from './TaskProgress.svelte';
import WarriorCard from './WarriorCard.svelte';

const NOW = 1_700_000_000_000;

const base: WarriorSnapshot = {
  id: 'w1',
  name: 'warrior-1',
  host: 'h',
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
  project: { title: 'P', name: null, logo: null, leaderboard: null, deadline: null },
  items: [],
  bandwidth: null,
  bandwidthHistory: [],
  counters: { completed: 0, failed: 0, canceled: 2 },
  broadcastMessage: 'Tracker maintenance tonight',
  catalog: {},
  rolling: {
    windowMs: 60_000,
    samples: 0,
    avgReceiving: 0,
    avgSending: 0,
    peakReceiving: 0,
    peakSending: 0,
  },
  updatedAt: NOW,
};

const totals = {
  warriors: 2,
  enabled: 2,
  connected: 2,
  receiving: 0,
  sending: 0,
  received: 0,
  sent: 0,
  itemsInFlight: 0,
  completed: 0,
  failed: 0,
  projects: [],
  rollingWindowMs: 60_000,
  avgReceiving: 0,
  avgSending: 0,
};

describe('WarriorCard status variants', () => {
  it.each([
    ['STARTING_PROJECT', 'Starting project', 'badge-info'],
    ['SWITCHING_PROJECT', 'Switching project', 'badge-info'],
    ['RESTARTING_PROJECT', 'Restarting project', 'badge-info'],
    ['INVALID_SETTINGS', 'Needs configuration', 'badge-warning'],
    ['UNINITIALIZED', 'Could not contact HQ', 'badge-warning'],
    ['STOPPING_PROJECT', 'Stopping project', 'badge-error'],
    ['SHUTTING_DOWN', 'Shutting down', 'badge-error'],
    ['REBOOTING', 'Rebooting', 'badge-error'],
  ] as const)('%s renders %s', (status, text, cls) => {
    render(WarriorCard, { warrior: { ...base, status }, now: NOW });
    expect(screen.getByText(text)).toHaveClass(cls);
  });

  it('shows stopping runner, canceled counter, announcement, and no logo or leaderboard', () => {
    render(WarriorCard, { warrior: { ...base, runnerStatus: 'stopping' }, now: NOW });
    expect(screen.getByText('stopping')).toBeInTheDocument();
    expect(screen.getByText(/2 canceled/)).toBeInTheDocument();
    expect(screen.getByText(/Announcement: Tracker maintenance tonight/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Leaderboard' })).not.toBeInTheDocument();
    expect(screen.queryByText(/average:/)).not.toBeInTheDocument();
    expect(screen.getByText('0 items running')).toBeInTheDocument();
  });

  it('omits the status badge when the warrior has not reported one and the error line without an error', () => {
    render(WarriorCard, {
      warrior: {
        ...base,
        status: null,
        connection: { ...base.connection, state: 'connecting', lastError: null },
      },
      now: NOW,
    });
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    expect(screen.queryByText(/last message/)).not.toBeInTheDocument();
  });
});

describe('ItemRow and TaskProgress variants', () => {
  const item: ItemSnapshot = {
    id: 'i',
    number: 3,
    name: 'Item ',
    status: 'canceled',
    tasks: [],
    logTail: '',
    startTime: NOW / 1000 - 10,
    finishedAt: NOW,
  };

  it('falls back to the item number, shows canceled, and reports missing output', () => {
    render(ItemRow, { item, now: NOW });
    expect(screen.getAllByText('#3')).toHaveLength(2);
    expect(screen.getByText('canceled')).toHaveClass('badge-warning');
    expect(screen.getByText('No output yet.')).toBeInTheDocument();
    expect(screen.getByText('10s')).toBeInTheDocument();
  });

  it('shows completed and a finished task list as done', () => {
    render(ItemRow, {
      item: { ...item, status: 'completed', tasks: [{ id: 1, name: 'A', status: 'completed' }] },
      now: NOW,
    });
    expect(screen.getByText('completed')).toHaveClass('badge-success');
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('renders an empty task list without dividing by zero', () => {
    render(TaskProgress, { tasks: [] });
    expect(screen.getByText('0/0')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '1');
  });
});

describe('FleetSummary variants', () => {
  it('omits the disabled note and shows none running', () => {
    render(FleetSummary, { totals });
    expect(screen.queryByText(/disabled/)).not.toBeInTheDocument();
    expect(screen.getByText('none running')).toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  it('shows a loader before hello, then the warrior grid', () => {
    fleet.ready = false;
    const { container, unmount } = render(Dashboard);
    expect(container.querySelector('.loading')).toBeInTheDocument();
    unmount();

    fleet.ready = true;
    fleet.warriors = { w1: base, w2: { ...base, id: 'w2', name: 'warrior-2' } };
    fleet.totals = totals;
    render(Dashboard);
    expect(screen.getByText('warrior-1')).toBeInTheDocument();
    expect(screen.getByText('warrior-2')).toBeInTheDocument();
    fleet.warriors = {};
  });
});

describe('format edge cases', () => {
  it('handles never-seen and negative values', () => {
    expect(formatAgo(null, NOW)).toBe('never');
    expect(formatAgo(NOW - 5000, NOW)).toBe('5s ago');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});
