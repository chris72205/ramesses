import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog, FIXTURE_NOW, summary, warriorOn } from '../test/project-fixtures';
import { fleet } from '../lib/fleet.svelte';
import type * as ApiModule from '../lib/api';
import { projects } from '../lib/projects.svelte';
import ProjectsPage from './ProjectsPage.svelte';

const mocks = vi.hoisted(() => ({ listProjects: vi.fn(), refreshProjects: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return { ...original, api: { ...original.api, ...mocks } };
});

function rowNames(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row).getAllByRole('cell')[0]!.querySelector('.font-mono')!.textContent!.trim(),
    );
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    projects.items = [];
    projects.loadedAt = null;
    projects.error = null;
    projects.includeHidden = false;
    fleet.now = FIXTURE_NOW; // deadlines and ages in the fixtures are relative to this instant
    fleet.warriors = {};
    mocks.listProjects.mockResolvedValue(catalog);
  });
  afterEach(() => {
    mocks.listProjects.mockReset();
    mocks.refreshProjects.mockReset();
  });

  it('loads the catalog and lists visible projects sorted by 24 h rate', async () => {
    render(ProjectsPage);
    expect(await screen.findByRole('link', { name: 'Blogger' })).toBeInTheDocument();
    // blogger (450k/h) first, pastebin (30/h), telegram (0/h); missing rates sink to the bottom
    expect(rowNames()).toEqual(['blogger', 'pastebin', 'telegram', 'urlteam2']);
    expect(screen.getByRole('img', { name: 'Recommended by Archive Team' })).toHaveTextContent('★');
    expect(screen.getByText(/Stats unavailable/)).toBeInTheDocument();
    expect(screen.getByText('3d 4h left')).toBeInTheDocument();
    expect(screen.getByText('450K/h')).toBeInTheDocument();
    expect(screen.getByText('16.5M')).toBeInTheDocument();
    expect(screen.getByLabelText('last sample failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Blogger' })).toHaveAttribute(
      'href',
      '/projects/blogger',
    );
  });

  it('sorts by column and toggles hidden projects', async () => {
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Blogger' });
    await fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(rowNames()).toEqual(['blogger', 'pastebin', 'telegram', 'urlteam2']);
    await fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(rowNames()[0]).toBe('urlteam2');
    await fireEvent.click(screen.getByRole('button', { name: /To do/ }));
    expect(rowNames()).toEqual(['telegram', 'blogger', 'pastebin', 'urlteam2']);
    await fireEvent.click(screen.getByRole('button', { name: /Queue/ }));
    expect(rowNames()[0]).toBe('telegram'); // backlog ranks highest

    await fireEvent.click(screen.getByLabelText('Show hidden'));
    await waitFor(() => expect(rowNames()).toContain('oldproject'));
    expect(screen.getByText('retired')).toBeInTheDocument();
  });

  it('requests a refresh and explains the throttle', async () => {
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Blogger' });
    mocks.refreshProjects.mockResolvedValueOnce({
      requested: false,
      lastRunAt: new Date(Date.now() - 60_000).toISOString(),
      nextAllowedAt: new Date(Date.now() + 240_000).toISOString(),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Next refresh allowed at/);

    mocks.refreshProjects.mockResolvedValueOnce({
      requested: true,
      lastRunAt: null,
      nextAllowedAt: null,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Refresh requested/));

    mocks.refreshProjects.mockResolvedValueOnce({
      requested: false,
      lastRunAt: new Date(Date.now() - 60_000).toISOString(),
      nextAllowedAt: null,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Sampled .* ago\. Too soon/),
    );

    mocks.refreshProjects.mockRejectedValueOnce(new Error('nope'));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Refresh failed: nope/),
    );
  });

  it('shows errors with a retry and an empty state', async () => {
    mocks.listProjects
      .mockReset()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce([]);
    render(ProjectsPage);
    expect(await screen.findByRole('alert')).toHaveTextContent(/ECONNREFUSED/);
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
  });

  it('sorts by deadline and sample time, and marks closed deadlines', async () => {
    projects.items = [
      ...catalog,
      summary({
        name: 'expired',
        title: 'Closed Project',
        logo: null,
        deadline: new Date(FIXTURE_NOW - 3_600_000).toISOString(),
        lastSampledAt: new Date(FIXTURE_NOW - 7_200_000).toISOString(),
      }),
    ];
    projects.loadedAt = Date.now();
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Closed Project' });
    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(screen.getByText('closed')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Deadline' }));
    expect(rowNames().slice(0, 2)).toEqual(['expired', 'telegram']); // ascending: past first
    await fireEvent.click(screen.getByRole('button', { name: 'Deadline' }));
    expect(rowNames().slice(0, 2)).toEqual(['telegram', 'expired']);

    await fireEvent.click(screen.getByRole('button', { name: 'Sampled' }));
    expect(rowNames()[0]).not.toBe('expired'); // most recent first
    expect(rowNames()[rowNames().length - 1]).toBe('urlteam2'); // never sampled sinks
    await fireEvent.click(screen.getByRole('button', { name: 'Sampled' }));
    expect(rowNames()[0]).toBe('expired');
    await fireEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(rowNames()[0]).toBe('telegram');
    await fireEvent.click(screen.getByRole('button', { name: /Done\/h \(1 h\)/ }));
    expect(rowNames()[0]).toBe('blogger');
  });

  it('counts your warriors per project from the live fleet and sorts by it', async () => {
    fleet.warriors = {
      a: warriorOn('a', 'telegram', 'alpha'),
      b: warriorOn('b', 'telegram', 'beta'),
      c: warriorOn('c', 'blogger', 'gamma'),
    };
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Blogger' });
    const telegramRow = screen
      .getAllByRole('row')
      .find((row) => within(row).queryByRole('link', { name: 'Telegram' }))!;
    expect(within(telegramRow).getByTitle('alpha, beta')).toHaveTextContent('2');
    await fireEvent.click(screen.getByRole('button', { name: 'Warriors' }));
    expect(rowNames().slice(0, 2)).toEqual(['telegram', 'blogger']);
    fleet.warriors = {};
    await waitFor(() =>
      expect(within(telegramRow).queryByTitle('alpha, beta')).not.toBeInTheDocument(),
    );
  });
});
