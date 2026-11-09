import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { searchParams } from 'sv-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog, FIXTURE_NOW, summary, warriorOn } from '../test/project-fixtures';
import { fleet } from '../lib/fleet.svelte';
import type * as ApiModule from '../lib/api';
import { notifications } from '../lib/notifications.svelte';
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

/** The URL query the page wrote, decoded for readable assertions. */
function urlQuery(): string {
  return decodeURIComponent(window.location.search.replace(/^\?/, ''));
}

function clearUrl(): void {
  for (const key of [...searchParams.keys()])
    searchParams.delete(key, undefined, { replace: true });
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    clearUrl();
    projects.items = [];
    projects.loadedAt = null;
    projects.error = null;
    fleet.now = FIXTURE_NOW; // deadlines and ages in the fixtures are relative to this instant
    fleet.warriors = {};
    notifications.clear();
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
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    expect(urlQuery()).toBe('');
  });

  it('sorts by column, keeps the sort in the URL, and toggles hidden projects', async () => {
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Blogger' });
    await fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(rowNames()).toEqual(['blogger', 'pastebin', 'telegram', 'urlteam2']);
    expect(urlQuery()).toBe('sort=title');
    await fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(rowNames()[0]).toBe('urlteam2');
    expect(urlQuery()).toBe('sort=title&dir=desc');
    await fireEvent.click(screen.getByRole('button', { name: /To do/ }));
    expect(rowNames()).toEqual(['telegram', 'blogger', 'pastebin', 'urlteam2']);
    await fireEvent.click(screen.getByRole('button', { name: /Queue/ }));
    expect(rowNames()[0]).toBe('telegram'); // backlog ranks highest
    expect(screen.getByRole('columnheader', { name: /Queue/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    await fireEvent.click(screen.getByLabelText('Show hidden'));
    await waitFor(() => expect(rowNames()).toContain('oldproject'));
    expect(screen.getByText('retired')).toBeInTheDocument();
    expect(urlQuery()).toBe('hidden=1&sort=health');
    // "Show hidden" counts as a change worth resetting, even though it narrows nothing.
    expect(screen.getByText('5 of 5 projects')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(rowNames()).not.toContain('oldproject'));
    expect(urlQuery()).toBe('sort=health'); // the sort is not a filter
  });

  it('reads filters from the URL and writes changes back without history entries', async () => {
    searchParams.set('q', 'tele', { replace: true });
    searchParams.set('mine', 'running', { replace: true });
    searchParams.set('page', '2', { replace: true }); // not ours; must survive
    fleet.warriors = { a: warriorOn('a', 'telegram', 'alpha') };
    const pushState = vi.spyOn(window.history, 'pushState');
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Telegram' });
    expect(rowNames()).toEqual(['telegram']);
    expect(screen.getByLabelText('Search projects')).toHaveValue('tele');
    expect(screen.getByLabelText('Your warriors')).toHaveValue('running');
    expect(screen.getByText('1 of 5 projects')).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('Search projects'), { target: { value: 'zz' } });
    expect(await screen.findByText('No projects match the current filters.')).toBeInTheDocument();
    expect(
      screen.getByText('Active filters: search "zz", running on your warriors.'),
    ).toBeInTheDocument();
    expect(urlQuery()).toBe('page=2&q=zz&mine=running'); // keys this page does not own stay put
    expect(pushState).not.toHaveBeenCalled();

    // The empty state has its own reset button besides the one in the filter bar.
    expect(screen.getAllByRole('button', { name: 'Reset filters' })).toHaveLength(2);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[1]!);
    await waitFor(() =>
      expect(rowNames()).toEqual(['blogger', 'pastebin', 'telegram', 'urlteam2']),
    );
    expect(urlQuery()).toBe('page=2');
    expect(screen.getByLabelText('Search projects')).toHaveValue('');
    pushState.mockRestore();
  });

  it('narrows by queue health, tracker, warriors, deadline, and recommendation', async () => {
    fleet.warriors = { a: warriorOn('a', 'telegram', 'alpha') };
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Blogger' });
    const chips = within(screen.getByRole('group', { name: 'Queue health' }));

    await fireEvent.click(chips.getByRole('button', { name: 'Drained' }));
    expect(chips.getByRole('button', { name: 'Drained' })).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['pastebin']);
    await fireEvent.click(chips.getByRole('button', { name: 'Backlog' }));
    expect(rowNames()).toEqual(['pastebin', 'telegram']);
    expect(urlQuery()).toBe('health=backlog,drained');

    await fireEvent.change(screen.getByLabelText('Tracker'), {
      target: { value: 'terroroftinytown' },
    });
    expect(await screen.findByText(/Active filters:/)).toHaveTextContent(
      'Active filters: queue backlog or drained, urlteam.',
    );
    expect(urlQuery()).toBe('health=backlog,drained&tracker=terroroftinytown');
    await fireEvent.click(chips.getByRole('button', { name: 'Drained' }));
    await fireEvent.click(chips.getByRole('button', { name: 'Backlog' }));
    await waitFor(() => expect(rowNames()).toEqual(['urlteam2']));
    await fireEvent.change(screen.getByLabelText('Tracker'), { target: { value: '' } });
    await waitFor(() => expect(rowNames()).toHaveLength(4));
    expect(urlQuery()).toBe('');

    await fireEvent.click(screen.getByLabelText('Has a deadline'));
    expect(rowNames()).toEqual(['telegram']);
    await fireEvent.click(screen.getByLabelText("ArchiveTeam's Choice"));
    expect(rowNames()).toEqual(['telegram']);
    expect(urlQuery()).toBe('deadline=1&choice=1');
    await fireEvent.change(screen.getByLabelText('Your warriors'), { target: { value: 'idle' } });
    expect(await screen.findByText(/Active filters:/)).toHaveTextContent(
      "not running on your warriors, has a deadline, ArchiveTeam's Choice.",
    );
    await fireEvent.change(screen.getByLabelText('Your warriors'), {
      target: { value: 'running' },
    });
    await waitFor(() => expect(rowNames()).toEqual(['telegram']));
    expect(urlQuery()).toBe('mine=running&deadline=1&choice=1');
  });

  it('offers to show hidden projects when the whole catalog is hidden', async () => {
    projects.items = catalog.filter((project) => project.name === 'oldproject');
    projects.loadedAt = Date.now();
    render(ProjectsPage);
    expect(
      await screen.findByText('Every project in the catalog is unlisted or retired.'),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show hidden projects' }));
    await waitFor(() => expect(rowNames()).toEqual(['oldproject']));
    expect(urlQuery()).toBe('hidden=1');
    expect(screen.getByLabelText('Show hidden')).toBeChecked();
  });

  it('requests a refresh and explains the throttle through toasts', async () => {
    render(ProjectsPage);
    await screen.findByRole('link', { name: 'Blogger' });
    const latest = () => notifications.items.at(-1);
    mocks.refreshProjects.mockResolvedValueOnce({
      requested: false,
      lastRunAt: new Date(Date.now() - 60_000).toISOString(),
      nextAllowedAt: new Date(Date.now() + 240_000).toISOString(),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(latest()?.message).toMatch(/Next refresh allowed at/));
    expect(latest()?.level).toBe('info');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    mocks.refreshProjects.mockResolvedValueOnce({
      requested: true,
      lastRunAt: null,
      nextAllowedAt: null,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(latest()?.message).toMatch(/Refresh requested/));
    expect(latest()?.level).toBe('success');

    mocks.refreshProjects.mockResolvedValueOnce({
      requested: false,
      lastRunAt: new Date(Date.now() - 60_000).toISOString(),
      nextAllowedAt: null,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(latest()?.message).toMatch(/Sampled .* ago\. Too soon/));

    mocks.refreshProjects.mockRejectedValueOnce(new Error('nope'));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(latest()?.message).toBe('Refresh failed: nope'));
    expect(latest()?.level).toBe('error');
    expect(notifications.items).toHaveLength(4);
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
    expect(screen.queryByRole('form', { name: 'Filters' })).not.toBeInTheDocument();
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
