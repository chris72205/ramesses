import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHistory } from '@ramesses/shared';
import { catalog, FIXTURE_NOW, summary } from '../test/project-fixtures';
import type * as ApiModule from '../lib/api';
import { fleet } from '../lib/fleet.svelte';
import { projects } from '../lib/projects.svelte';
import ProjectDetailPage from './ProjectDetailPage.svelte';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProjectHistory: vi.fn(),
  params: { name: 'blogger' } as { name?: string },
}));
vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, ...mocks } };
});
vi.mock('../lib/router', () => ({
  p: (path: string, options?: { params?: Record<string, string> }) =>
    path.replace(/:(\w+)/g, (_, key: string) => options?.params?.[key] ?? ''),
  route: { params: mocks.params },
}));

function history(range: ProjectHistory['range'], n = 5): ProjectHistory {
  return {
    name: 'blogger',
    range,
    resolution: range === '24h' ? 'raw' : 'hourly',
    points: Array.from({ length: n }, (_, i) => ({
      sampledAt: new Date(FIXTURE_NOW - (n - i) * 900_000).toISOString(),
      todo: 100 + i,
      out: 5,
      done: 1000 + i * 100,
      downloaderCount: 3,
      donePerHour: i === 0 ? null : 400,
    })),
  };
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    projects.items = [];
    projects.loadedAt = null;
    projects.error = null;
    mocks.params.name = 'blogger';
    fleet.now = FIXTURE_NOW;
    mocks.listProjects.mockResolvedValue(catalog);
    mocks.getProjectHistory.mockImplementation((_name: string, range: ProjectHistory['range']) =>
      Promise.resolve(history(range)),
    );
  });
  afterEach(() => {
    mocks.listProjects.mockReset();
    mocks.getProjectHistory.mockReset();
  });

  it('renders the header, stat tiles, and both charts, and switches ranges', async () => {
    render(ProjectDetailPage);
    expect(await screen.findByRole('heading', { name: 'Blogger' })).toBeInTheDocument();
    expect(screen.getByText('Saving blogs.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute(
      'href',
      catalog[0]!.leaderboard,
    );
    expect(screen.getByText('28.1B')).toBeInTheDocument(); // done
    expect(screen.getByText('437K/h')).toBeInTheDocument();
    expect(screen.getByText(/work available in 100% of samples/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.getProjectHistory).toHaveBeenCalledWith('blogger', '24h'));
    expect(await screen.findByRole('img', { name: /Items to do/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Items done per hour/ })).toBeInTheDocument();
    expect(screen.getByText(/5 samples over the last 24 hours/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    await waitFor(() => expect(mocks.getProjectHistory).toHaveBeenCalledWith('blogger', '7d'));
    expect(await screen.findByText(/5 hourly points over the last 7 days/)).toBeInTheDocument();
  });

  it('shows the table view of a chart on demand', async () => {
    render(ProjectDetailPage);
    await screen.findByRole('img', { name: /Items to do/ });
    const details = screen.getAllByText('Show as table')[0]!.closest('details')!;
    details.open = true;
    await fireEvent(details, new Event('toggle'));
    expect(await screen.findByRole('columnheader', { name: 'Items to do' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5);
  });

  it('handles unknown projects, other trackers, and history errors', async () => {
    mocks.params.name = 'nope';
    const { unmount } = render(ProjectDetailPage);
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument();
    unmount();

    mocks.params.name = 'urlteam2';
    const second = render(ProjectDetailPage);
    expect(await screen.findByText(/different tracker/)).toBeInTheDocument();
    expect(mocks.getProjectHistory).not.toHaveBeenCalled();
    second.unmount();

    mocks.params.name = 'pastebin';
    mocks.getProjectHistory
      .mockReset()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(history('24h', 0));
    render(ProjectDetailPage);
    expect(await screen.findByText(/Last sample failed/)).toBeInTheDocument();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /Could not load history: timeout/.test(a.textContent ?? ''))).toBe(
      true,
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByText('No samples in this range yet')).toHaveLength(2);
  });

  it('reports a catalog load failure', async () => {
    mocks.listProjects.mockReset().mockRejectedValueOnce(new Error('down'));
    render(ProjectDetailPage);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load projects: down/);
  });

  it('shows recommendation, retirement, and deadline badges, and copes with sparse fields', async () => {
    projects.items = [
      catalog[1]!, // telegram: recommended, deadline in 3d 4h
      summary({
        name: 'bare',
        title: 'Bare',
        logo: null,
        description: '',
        leaderboard: null,
        repository: null,
        active: false,
        deadline: new Date(FIXTURE_NOW - 60_000).toISOString(),
      }),
    ];
    projects.loadedAt = Date.now();

    mocks.params.name = 'telegram';
    const first = render(ProjectDetailPage);
    expect(await screen.findByRole('heading', { name: 'Telegram' })).toBeInTheDocument();
    expect(screen.getByText('★ Recommended by Archive Team')).toBeInTheDocument();
    expect(screen.getByText('Deadline: 3d 4h left')).toBeInTheDocument();
    expect(screen.queryByText('retired')).not.toBeInTheDocument();
    first.unmount();

    mocks.params.name = 'bare';
    render(ProjectDetailPage);
    expect(await screen.findByRole('heading', { name: 'Bare' })).toBeInTheDocument();
    expect(screen.getByText('retired')).toBeInTheDocument();
    expect(screen.getByText('Deadline: closed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Leaderboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Repository' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '' })).not.toBeInTheDocument();
  });
});
