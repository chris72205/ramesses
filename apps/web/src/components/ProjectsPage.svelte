<script lang="ts">
  import { onMount } from 'svelte';
  import { searchParams } from 'sv-router';
  import type { QueueHealth, TrackerKind } from '@ramesses/shared';
  import { api } from '../lib/api';
  import { fleet } from '../lib/fleet.svelte';
  import {
    formatClock,
    formatCount,
    formatIsoAgo,
    formatPerHour,
    formatTimeLeft,
  } from '../lib/format';
  import {
    DEFAULT_FILTERS,
    defaultSortDir,
    describeFilters,
    filterProjects,
    HEALTH_LABELS,
    HEALTH_VALUES,
    isDefaultFilters,
    MINE_LABELS,
    MINE_VALUES,
    type MineFilter,
    parseProjectsQuery,
    type ProjectFilters,
    type ProjectsQuery,
    QUERY_KEYS,
    serializeProjectsQuery,
    type SortKey,
    sortProjects,
    TRACKER_LABELS,
    TRACKER_VALUES,
  } from '../lib/project-filters';
  import { notifications } from '../lib/notifications.svelte';
  import { projects } from '../lib/projects.svelte';
  import { p } from '../lib/router';
  import { groupWarriorsByProject } from '../lib/warriors-by-project';
  import HealthBadge from './HealthBadge.svelte';
  import Sparkline from './Sparkline.svelte';

  const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; title?: string }> = [
    { key: 'title', label: 'Project', numeric: false },
    {
      key: 'warriors',
      label: 'Warriors',
      numeric: true,
      title: 'Your warriors working on this project right now',
    },
    {
      key: 'health',
      label: 'Queue',
      numeric: false,
      title: 'How reliably work was available over the last day',
    },
    { key: 'todo', label: 'To do', numeric: true, title: 'Items waiting to be claimed' },
    { key: 'out', label: 'Out', numeric: true, title: 'Items checked out to workers right now' },
    {
      key: 'h1',
      label: 'Done/h (1 h)',
      numeric: true,
      title: 'Items completed per hour over the last hour',
    },
    {
      key: 'h24',
      label: 'Done/h (24 h)',
      numeric: true,
      title: 'Items completed per hour over the last day',
    },
    { key: 'deadline', label: 'Deadline', numeric: false },
    { key: 'sampled', label: 'Sampled', numeric: false },
  ];

  /**
   * The URL query is the only copy of the filter and sort state. sv-router keeps `searchParams`
   * in step with navigation and the back button; writes replace the current history entry so a
   * keystroke never adds one.
   */
  const query = $derived(parseProjectsQuery(new URLSearchParams(searchParams.toString())));
  const filters = $derived(query.filters);
  const sort = $derived(query.sort);

  function setQuery(next: ProjectsQuery) {
    const target = serializeProjectsQuery(next);
    if (target.toString() === serializeProjectsQuery(query).toString()) return;
    // Only the keys this view owns are touched, so anything else in the URL survives. They are
    // removed and written back in one canonical order, so the same view always has the same URL.
    for (const key of QUERY_KEYS) searchParams.delete(key, undefined, { replace: true });
    for (const [key, value] of target) searchParams.set(key, value, { replace: true });
  }

  function setFilters(patch: Partial<ProjectFilters>) {
    setQuery({ ...query, filters: { ...filters, ...patch } });
  }

  function toggleHealth(value: QueueHealth) {
    setFilters({
      health: filters.health.includes(value)
        ? filters.health.filter((h) => h !== value)
        : [...filters.health, value],
    });
  }

  function resetFilters() {
    setQuery({ ...query, filters: DEFAULT_FILTERS });
  }

  function sortBy(key: SortKey) {
    setQuery({
      ...query,
      sort:
        sort.key === key
          ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: defaultSortDir(key) },
    });
  }

  const warriorsByProject = $derived(groupWarriorsByProject(fleet.list));
  const running = $derived(new Set(warriorsByProject.keys()));
  const rows = $derived(
    sortProjects(
      filterProjects(projects.items, filters, running),
      sort,
      (name) => warriorsByProject.get(name)?.length ?? 0,
    ),
  );
  const activeFilters = $derived(describeFilters(filters));
  const filtersActive = $derived(!isDefaultFilters(filters));

  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    try {
      const result = await api.refreshProjects();
      if (result.requested) {
        notifications.success(
          'Refresh requested. New numbers arrive here as soon as the sample finishes.',
        );
      } else {
        const sampled = `Sampled ${formatIsoAgo(result.lastRunAt, Date.now())}.`;
        notifications.info(
          result.nextAllowedAt
            ? `${sampled} Next refresh allowed at ${formatClock(Date.parse(result.nextAllowedAt))}.`
            : `${sampled} Too soon to sample again; try in a few minutes.`,
        );
      }
    } catch (error) {
      notifications.error(
        `Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    if (projects.loadedAt === null) void projects.load();
  });
</script>

<section class="space-y-4">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Projects</h1>
      <p class="text-sm text-base-content/60">
        Archive Team tracker numbers, sampled every 15 minutes.
        {#if projects.lastSampledAt}
          Last sample {formatIsoAgo(projects.lastSampledAt, fleet.now)}.
        {/if}
      </p>
    </div>
    <button class="btn btn-sm btn-outline" onclick={() => void refresh()} disabled={refreshing}>
      {#if refreshing}<span class="loading loading-spinner loading-xs"></span>{/if}
      Refresh now
    </button>
  </header>

  {#if projects.error}
    <div role="alert" class="alert alert-error">
      <span>Could not load projects: {projects.error}</span>
      <button class="btn btn-sm" onclick={() => void projects.load()}>Retry</button>
    </div>
  {:else if projects.loadedAt === null}
    <div class="flex justify-center py-24">
      <span class="loading loading-dots loading-lg"></span>
    </div>
  {:else if projects.items.length === 0}
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body items-center text-center">
        <p>No projects yet. The first sample arrives shortly after the backend starts.</p>
      </div>
    </div>
  {:else}
    <form
      class="card bg-base-100 shadow-sm"
      aria-label="Filters"
      onsubmit={(event) => event.preventDefault()}
    >
      <div class="card-body gap-3 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <label class="input input-sm w-full sm:w-72">
            <svg
              class="h-4 w-4 opacity-50"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              class="grow"
              placeholder="Search by name or title"
              aria-label="Search projects"
              autocomplete="off"
              value={filters.query}
              oninput={(event) => setFilters({ query: event.currentTarget.value })}
            />
          </label>
          <select
            class="select select-sm w-full sm:w-auto"
            aria-label="Tracker"
            value={filters.tracker ?? ''}
            onchange={(event) =>
              setFilters({ tracker: (event.currentTarget.value || null) as TrackerKind | null })}
          >
            <option value="">Any tracker</option>
            {#each TRACKER_VALUES as value (value)}
              <option {value}>{TRACKER_LABELS[value]}</option>
            {/each}
          </select>
          <select
            class="select select-sm w-full sm:w-auto"
            aria-label="Your warriors"
            value={filters.mine}
            onchange={(event) => setFilters({ mine: event.currentTarget.value as MineFilter })}
          >
            {#each MINE_VALUES as value (value)}
              <option {value}>{MINE_LABELS[value]}</option>
            {/each}
          </select>
          {#if filtersActive}
            <div class="flex items-center gap-3 text-sm text-base-content/60 sm:ml-auto">
              <span>{rows.length} of {projects.items.length} projects</span>
              <button type="button" class="btn btn-sm btn-ghost" onclick={resetFilters}>
                Reset filters
              </button>
            </div>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div role="group" aria-label="Queue health" class="flex flex-wrap items-center gap-1.5">
            <span class="mr-1 text-xs text-base-content/60">Queue</span>
            {#each HEALTH_VALUES as value (value)}
              {@const selected = filters.health.includes(value)}
              <button
                type="button"
                class="btn btn-xs {selected ? 'btn-primary' : 'btn-ghost border-base-300'}"
                aria-pressed={selected}
                onclick={() => toggleHealth(value)}
              >
                {HEALTH_LABELS[value]}
              </button>
            {/each}
          </div>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={filters.deadline}
                onchange={(event) => setFilters({ deadline: event.currentTarget.checked })}
              />
              Has a deadline
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={filters.choice}
                onchange={(event) => setFilters({ choice: event.currentTarget.checked })}
              />
              ArchiveTeam's Choice
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                checked={filters.hidden}
                onchange={(event) => setFilters({ hidden: event.currentTarget.checked })}
              />
              Show hidden
            </label>
          </div>
        </div>
      </div>
    </form>

    {#if rows.length === 0}
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body items-center gap-3 text-center">
          {#if activeFilters.length > 0}
            <p>No projects match the current filters.</p>
            <p class="text-sm text-base-content/60">
              Active filters: {activeFilters.join(', ')}.
            </p>
            <button type="button" class="btn btn-sm btn-outline" onclick={resetFilters}>
              Reset filters
            </button>
          {:else}
            <p>Every project in the catalog is unlisted or retired.</p>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              onclick={() => setFilters({ hidden: true })}
            >
              Show hidden projects
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="card bg-base-100 shadow-sm">
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                {#each COLUMNS as column (column.key)}
                  <th
                    class={column.numeric ? 'text-right' : ''}
                    aria-sort={sort.key === column.key
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'}
                  >
                    <button
                      class="inline-flex items-center gap-1 hover:text-base-content"
                      title={column.title}
                      onclick={() => sortBy(column.key)}
                    >
                      {column.label}
                      {#if sort.key === column.key}
                        <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                      {/if}
                    </button>
                  </th>
                {/each}
                <th>Trend (24 h)</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as project (project.name)}
                {@const timeLeft = formatTimeLeft(project.deadline, fleet.now)}
                {@const mine = warriorsByProject.get(project.name) ?? []}
                <tr class={project.active ? '' : 'opacity-60'}>
                  <td>
                    <div class="flex items-center gap-3">
                      {#if project.logo}
                        <img
                          src={project.logo}
                          alt=""
                          class="h-8 w-8 shrink-0 rounded bg-base-200 object-contain"
                          loading="lazy"
                        />
                      {:else}
                        <div class="h-8 w-8 shrink-0 rounded bg-base-200"></div>
                      {/if}
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                          <a
                            class="link link-hover font-medium"
                            href={p('/projects/:name', { params: { name: project.name } })}
                          >
                            {project.title}
                          </a>
                          {#if project.isAuto}
                            <span
                              class="text-primary"
                              title="Recommended by Archive Team (ArchiveTeam's Choice)"
                              aria-label="Recommended by Archive Team"
                              role="img">★</span
                            >
                          {/if}
                        </div>
                        <div class="flex flex-wrap gap-1 text-xs text-base-content/60">
                          <span class="font-mono">{project.name}</span>
                          {#if !project.active}
                            <span class="badge badge-xs badge-ghost">retired</span>
                          {/if}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td
                    class="text-right font-mono tabular-nums"
                    title={mine.length ? mine.map((w) => w.name).join(', ') : undefined}
                  >
                    {#if mine.length}
                      {mine.length}
                    {:else}
                      <span class="text-base-content/40">&mdash;</span>
                    {/if}
                  </td>
                  {#if project.tracker !== 'universal'}
                    <td colspan="5" class="text-sm text-base-content/50">
                      Stats unavailable: this project runs on a different tracker.
                    </td>
                  {:else}
                    <td><HealthBadge health={project.health} /></td>
                    <td
                      class="text-right font-mono tabular-nums"
                      title={project.todo24h
                        ? `Last 24 h: ${formatCount(project.todo24h.min)} to ${formatCount(project.todo24h.max)} across ${project.todo24h.samples} samples`
                        : undefined}
                    >
                      {formatCount(project.latest?.todo)}
                    </td>
                    <td class="text-right font-mono tabular-nums"
                      >{formatCount(project.latest?.out)}</td
                    >
                    <td class="text-right font-mono tabular-nums"
                      >{formatPerHour(project.doneRate.h1)}</td
                    >
                    <td class="text-right font-mono tabular-nums"
                      >{formatPerHour(project.doneRate.h24)}</td
                    >
                  {/if}
                  <td class="text-sm">
                    {#if timeLeft}
                      <span
                        class="badge badge-sm {timeLeft === 'closed'
                          ? 'badge-ghost'
                          : 'badge-warning badge-soft'}">{timeLeft}</span
                      >
                    {:else}
                      <span class="text-base-content/40">&mdash;</span>
                    {/if}
                  </td>
                  <td
                    class="text-sm text-base-content/70 whitespace-nowrap"
                    title={project.lastError ? `Last error: ${project.lastError}` : undefined}
                  >
                    {formatIsoAgo(project.lastSampledAt, fleet.now)}
                    {#if project.lastError}<span class="text-error" aria-label="last sample failed"
                        >!</span
                      >{/if}
                  </td>
                  <td>
                    <Sparkline
                      points={project.trend.map((t) => ({ at: t.at, value: t.perHour }))}
                      color="var(--viz-done)"
                      format={formatPerHour}
                      label="{project.title} completion rate over the last day"
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {/if}
</section>
