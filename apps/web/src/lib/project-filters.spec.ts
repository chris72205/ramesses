import { describe, expect, it } from 'vitest';
import { catalog, FIXTURE_NOW, summary } from '../test/project-fixtures';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  describeFilters,
  filterProjects,
  isDefaultFilters,
  parseProjectsQuery,
  type ProjectFilters,
  type ProjectsQuery,
  serializeProjectsQuery,
  sortProjects,
} from './project-filters';

const names = (items: { name: string }[]) => items.map((p) => p.name);
const filters = (overrides: Partial<ProjectFilters>): ProjectFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});
const none = new Set<string>();

describe('parseProjectsQuery and serializeProjectsQuery', () => {
  it('reads defaults from an empty query and writes defaults as an empty query', () => {
    const parsed = parseProjectsQuery(new URLSearchParams(''));
    expect(parsed).toEqual({ filters: DEFAULT_FILTERS, sort: DEFAULT_SORT });
    expect(serializeProjectsQuery(parsed).toString()).toBe('');
  });

  it('round-trips every filter and the sort, in canonical order', () => {
    const query: ProjectsQuery = {
      filters: {
        query: 'blog',
        health: ['drained', 'backlog'],
        tracker: 'terroroftinytown',
        mine: 'running',
        deadline: true,
        choice: true,
        hidden: true,
      },
      sort: { key: 'todo', dir: 'asc' },
    };
    const serialized = serializeProjectsQuery(query);
    expect(serialized.toString()).toBe(
      'q=blog&health=backlog%2Cdrained&tracker=terroroftinytown&mine=running&deadline=1&choice=1&hidden=1&sort=todo&dir=asc',
    );
    expect(parseProjectsQuery(serialized)).toEqual({
      ...query,
      filters: { ...query.filters, health: ['backlog', 'drained'] },
    });
  });

  it('leaves out a sort direction that is the column default', () => {
    expect(
      serializeProjectsQuery({
        filters: DEFAULT_FILTERS,
        sort: { key: 'title', dir: 'asc' },
      }).toString(),
    ).toBe('sort=title');
    expect(
      serializeProjectsQuery({
        filters: DEFAULT_FILTERS,
        sort: { key: 'h24', dir: 'asc' },
      }).toString(),
    ).toBe('dir=asc');
    expect(parseProjectsQuery(new URLSearchParams('sort=title')).sort).toEqual({
      key: 'title',
      dir: 'asc',
    });
    expect(parseProjectsQuery(new URLSearchParams('sort=deadline&dir=desc')).sort).toEqual({
      key: 'deadline',
      dir: 'desc',
    });
  });

  it('drops values it does not know and keeps the search text as typed', () => {
    const parsed = parseProjectsQuery(
      new URLSearchParams(
        'q=%20tele%20&health=drained,bogus,,healthy&tracker=mars&mine=sometimes&deadline=yes&sort=color&dir=up&page=3',
      ),
    );
    expect(parsed.filters).toEqual(filters({ query: ' tele ', health: ['healthy', 'drained'] }));
    expect(serializeProjectsQuery({ filters: parsed.filters, sort: parsed.sort }).toString()).toBe(
      'q=+tele+&health=healthy%2Cdrained',
    );
    expect(parsed.sort).toEqual(DEFAULT_SORT);
    // Every label selected narrows nothing, so it is not written.
    expect(
      serializeProjectsQuery({
        filters: filters({
          health: ['backlog', 'healthy', 'intermittent', 'drained', 'unknown'],
        }),
        sort: DEFAULT_SORT,
      }).toString(),
    ).toBe('');
  });
});

describe('filterProjects', () => {
  it('hides unlisted and retired projects unless asked to show them', () => {
    expect(names(filterProjects(catalog, DEFAULT_FILTERS, none))).toEqual([
      'blogger',
      'telegram',
      'urlteam2',
      'pastebin',
    ]);
    expect(names(filterProjects(catalog, filters({ hidden: true }), none))).toContain('oldproject');
    const unlisted = summary({ name: 'quiet', title: 'Quiet', listed: false });
    expect(filterProjects([unlisted], DEFAULT_FILTERS, none)).toEqual([]);
    expect(filterProjects([unlisted], filters({ hidden: true }), none)).toEqual([unlisted]);
  });

  it('matches the search text against the name and the title, ignoring case', () => {
    expect(names(filterProjects(catalog, filters({ query: 'TELE' }), none))).toEqual(['telegram']);
    expect(names(filterProjects(catalog, filters({ query: 'url' }), none))).toEqual(['urlteam2']);
    expect(names(filterProjects(catalog, filters({ query: 'Team 2' }), none))).toEqual([
      'urlteam2',
    ]);
    expect(filterProjects(catalog, filters({ query: 'zzz' }), none)).toEqual([]);
  });

  it('keeps the chosen queue-health labels and tracker kinds', () => {
    expect(
      names(filterProjects(catalog, filters({ health: ['drained', 'backlog'] }), none)),
    ).toEqual(['telegram', 'pastebin']);
    expect(names(filterProjects(catalog, filters({ tracker: 'terroroftinytown' }), none))).toEqual([
      'urlteam2',
    ]);
    expect(names(filterProjects(catalog, filters({ tracker: 'universal' }), none))).toEqual([
      'blogger',
      'telegram',
      'pastebin',
    ]);
  });

  it('splits the list by whether your warriors are on the project', () => {
    const running = new Set(['telegram', 'oldproject']);
    expect(names(filterProjects(catalog, filters({ mine: 'running' }), running))).toEqual([
      'telegram',
    ]);
    expect(names(filterProjects(catalog, filters({ mine: 'idle' }), running))).toEqual([
      'blogger',
      'urlteam2',
      'pastebin',
    ]);
    expect(
      names(filterProjects(catalog, filters({ mine: 'running', hidden: true }), running)),
    ).toEqual(['telegram', 'oldproject']);
  });

  it('keeps projects with a deadline and the recommended project', () => {
    expect(names(filterProjects(catalog, filters({ deadline: true }), none))).toEqual(['telegram']);
    expect(names(filterProjects(catalog, filters({ choice: true }), none))).toEqual(['telegram']);
  });

  it('combines filters with AND', () => {
    const running = new Set(['telegram', 'blogger']);
    expect(
      names(filterProjects(catalog, filters({ mine: 'running', health: ['healthy'] }), running)),
    ).toEqual(['blogger']);
    expect(
      filterProjects(catalog, filters({ mine: 'running', health: ['drained'] }), running),
    ).toEqual([]);
    expect(
      names(
        filterProjects(
          catalog,
          filters({ query: 'e', tracker: 'universal', deadline: true, choice: true }),
          none,
        ),
      ),
    ).toEqual(['telegram']);
  });
});

describe('describeFilters and isDefaultFilters', () => {
  it('names the narrowing filters in words and ignores "show hidden"', () => {
    expect(describeFilters(DEFAULT_FILTERS)).toEqual([]);
    expect(describeFilters(filters({ hidden: true }))).toEqual([]);
    expect(
      describeFilters(
        filters({
          query: ' blog ',
          health: ['drained', 'intermittent'],
          tracker: 'universal',
          mine: 'running',
          deadline: true,
          choice: true,
        }),
      ),
    ).toEqual([
      'search "blog"',
      'queue intermittent or drained',
      'universal tracker',
      'running on your warriors',
      'has a deadline',
      "ArchiveTeam's Choice",
    ]);
    expect(describeFilters(filters({ mine: 'idle', tracker: 'terroroftinytown' }))).toEqual([
      'urlteam',
      'not running on your warriors',
    ]);
  });

  it('treats "show hidden" as a change from the defaults', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters(filters({ hidden: true }))).toBe(false);
    expect(isDefaultFilters(filters({ query: 'x' }))).toBe(false);
  });
});

describe('sortProjects', () => {
  const count = (name: string) => (name === 'telegram' ? 2 : name === 'blogger' ? 1 : 0);

  it('sorts by each column with missing values at the bottom either way', () => {
    expect(names(sortProjects(catalog, DEFAULT_SORT, count))).toEqual([
      'blogger',
      'pastebin',
      'telegram',
      'oldproject', // the two without a rate fall back to title order
      'urlteam2',
    ]);
    expect(names(sortProjects(catalog, { key: 'h24', dir: 'asc' }, count)).slice(0, 3)).toEqual([
      'telegram',
      'pastebin',
      'blogger',
    ]);
    expect(names(sortProjects(catalog, { key: 'title', dir: 'asc' }, count))).toEqual([
      'blogger',
      'oldproject',
      'pastebin',
      'telegram',
      'urlteam2',
    ]);
    expect(
      names(sortProjects(catalog, { key: 'warriors', dir: 'desc' }, count)).slice(0, 2),
    ).toEqual(['telegram', 'blogger']);
    expect(names(sortProjects(catalog, { key: 'health', dir: 'desc' }, count))[0]).toBe('telegram');
    expect(names(sortProjects(catalog, { key: 'todo', dir: 'desc' }, count))[0]).toBe('telegram');
    expect(names(sortProjects(catalog, { key: 'out', dir: 'asc' }, count))[0]).toBe('pastebin');
    expect(names(sortProjects(catalog, { key: 'h1', dir: 'desc' }, count))[0]).toBe('blogger');
    expect(names(sortProjects(catalog, { key: 'deadline', dir: 'asc' }, count))[0]).toBe(
      'telegram',
    );
    const stale = summary({
      name: 'stale',
      title: 'Stale',
      lastSampledAt: new Date(FIXTURE_NOW - 7_200_000).toISOString(),
    });
    // Four projects share the latest sample time and fall back to title order; the never-sampled
    // one sinks below the stale one.
    expect(
      names(sortProjects([...catalog, stale], { key: 'sampled', dir: 'desc' }, count)),
    ).toEqual(['blogger', 'oldproject', 'pastebin', 'telegram', 'stale', 'urlteam2']);
  });
});
