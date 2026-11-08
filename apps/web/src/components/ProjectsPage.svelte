<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectSummary, QueueHealth } from '@ramesses/shared';
  import { api } from '../lib/api';
  import { fleet } from '../lib/fleet.svelte';
  import {
    formatClock,
    formatCount,
    formatIsoAgo,
    formatPerHour,
    formatTimeLeft,
  } from '../lib/format';
  import { projects } from '../lib/projects.svelte';
  import { p } from '../lib/router';
  import HealthBadge from './HealthBadge.svelte';
  import Sparkline from './Sparkline.svelte';

  type SortKey = 'title' | 'health' | 'todo' | 'out' | 'h1' | 'h24' | 'deadline' | 'sampled';
  const HEALTH_RANK: Record<QueueHealth, number> = {
    backlog: 4,
    healthy: 3,
    intermittent: 2,
    drained: 1,
    unknown: 0,
  };
  const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; title?: string }> = [
    { key: 'title', label: 'Project', numeric: false },
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

  let sortKey = $state<SortKey>('h24');
  let sortDir = $state<'asc' | 'desc'>('desc');

  function sortValue(project: ProjectSummary, key: SortKey): number | string | null {
    switch (key) {
      case 'title':
        return project.title.toLowerCase();
      case 'health':
        return HEALTH_RANK[project.health];
      case 'todo':
        return project.latest?.todo ?? null;
      case 'out':
        return project.latest?.out ?? null;
      case 'h1':
        return project.doneRate.h1;
      case 'h24':
        return project.doneRate.h24;
      case 'deadline':
        return project.deadline ? Date.parse(project.deadline) : null;
      case 'sampled':
        return project.lastSampledAt ? Date.parse(project.lastSampledAt) : null;
    }
  }

  const rows = $derived.by(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...projects.visible].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      // Missing values sink to the bottom whichever way the column is sorted.
      if (va === null && vb === null) return a.title.localeCompare(b.title);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.title.localeCompare(b.title);
    });
  });

  function sortBy(key: SortKey) {
    if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
      sortKey = key;
      sortDir = key === 'title' || key === 'deadline' ? 'asc' : 'desc';
    }
  }

  let refreshNote = $state<string | null>(null);
  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    try {
      const result = await api.refreshProjects();
      if (result.requested) {
        refreshNote = 'Refresh requested. New numbers arrive in a few seconds.';
        setTimeout(() => void projects.load(), 15_000);
      } else {
        const sampled = `Sampled ${formatIsoAgo(result.lastRunAt, Date.now())}.`;
        refreshNote = result.nextAllowedAt
          ? `${sampled} Next refresh allowed at ${formatClock(Date.parse(result.nextAllowedAt))}.`
          : `${sampled} Too soon to sample again; try in a few minutes.`;
      }
    } catch (error) {
      refreshNote = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
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
    <div class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" class="toggle toggle-sm" bind:checked={projects.includeHidden} />
        Show hidden
      </label>
      <button class="btn btn-sm btn-outline" onclick={() => void refresh()} disabled={refreshing}>
        {#if refreshing}<span class="loading loading-spinner loading-xs"></span>{/if}
        Refresh now
      </button>
    </div>
  </header>

  {#if refreshNote}
    <div role="status" class="alert alert-soft text-sm py-2">{refreshNote}</div>
  {/if}

  {#if projects.error}
    <div role="alert" class="alert alert-error">
      <span>Could not load projects: {projects.error}</span>
      <button class="btn btn-sm" onclick={() => void projects.load()}>Retry</button>
    </div>
  {:else if projects.loadedAt === null}
    <div class="flex justify-center py-24">
      <span class="loading loading-dots loading-lg"></span>
    </div>
  {:else if rows.length === 0}
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body items-center text-center">
        <p>No projects yet. The first sample arrives shortly after the backend starts.</p>
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
                  aria-sort={sortKey === column.key
                    ? sortDir === 'asc'
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
                    {#if sortKey === column.key}
                      <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
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
                      <a
                        class="link link-hover font-medium"
                        href={p('/projects/:name', { params: { name: project.name } })}
                      >
                        {project.title}
                      </a>
                      <div class="flex flex-wrap gap-1 text-xs text-base-content/60">
                        <span class="font-mono">{project.name}</span>
                        {#if project.isAuto}
                          <span
                            class="badge badge-xs badge-primary badge-soft"
                            title="ArchiveTeam's Choice: the tracker's own recommendation"
                            >★ Recommended by Archive Team</span
                          >
                        {/if}
                        {#if !project.active}
                          <span class="badge badge-xs badge-ghost">retired</span>
                        {/if}
                      </div>
                    </div>
                  </div>
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
</section>
