<script lang="ts">
  import { onMount } from 'svelte';
  import { WARRIOR_STATUS_TEXT, type HistoryRange, type ProjectHistory } from '@ramesses/shared';
  import { api } from '../lib/api';
  import { fleet } from '../lib/fleet.svelte';
  import {
    formatCount,
    formatDateTime,
    formatIsoAgo,
    formatPerHour,
    formatTimeLeft,
  } from '../lib/format';
  import { projects } from '../lib/projects.svelte';
  import { p, route } from '../lib/router';
  import { groupWarriorsByProject } from '../lib/warriors-by-project';
  import HealthBadge from './HealthBadge.svelte';
  import HistoryChart from './HistoryChart.svelte';

  const RANGES: Array<{ value: HistoryRange; label: string }> = [
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
  ];

  const name = $derived(route.params.name ?? '');
  const project = $derived(projects.byName.get(name) ?? null);
  const timeLeft = $derived(project ? formatTimeLeft(project.deadline, fleet.now) : null);
  const mine = $derived(groupWarriorsByProject(fleet.list).get(name) ?? []);

  let range = $state<HistoryRange>('24h');
  let history = $state<ProjectHistory | null>(null);
  let historyError = $state<string | null>(null);
  let historyLoading = $state(false);
  let request = 0;

  async function loadHistory(forName: string, forRange: HistoryRange) {
    const id = ++request;
    historyLoading = true;
    try {
      const result = await api.getProjectHistory(forName, forRange);
      if (id !== request) return;
      history = result;
      historyError = null;
    } catch (error) {
      if (id !== request) return;
      historyError = error instanceof Error ? error.message : String(error);
    } finally {
      if (id === request) historyLoading = false;
    }
  }

  $effect(() => {
    if (name && project?.tracker === 'universal') void loadHistory(name, range);
  });

  onMount(() => {
    if (projects.loadedAt === null) void projects.load();
  });

  const todoSeries = $derived(
    (history?.points ?? []).map((pt) => ({ at: Date.parse(pt.sampledAt), value: pt.todo })),
  );
  const rateSeries = $derived(
    (history?.points ?? []).map((pt) => ({ at: Date.parse(pt.sampledAt), value: pt.donePerHour })),
  );
</script>

<section class="space-y-4">
  <a class="link link-hover text-sm text-base-content/60" href={p('/projects')}>← All projects</a>

  {#if projects.error}
    <div role="alert" class="alert alert-error">
      <span>Could not load projects: {projects.error}</span>
      <button class="btn btn-sm" onclick={() => void projects.load()}>Retry</button>
    </div>
  {:else if projects.loadedAt === null}
    <div class="flex justify-center py-24">
      <span class="loading loading-dots loading-lg"></span>
    </div>
  {:else if !project}
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body items-center text-center gap-2">
        <h1 class="card-title">Project not found</h1>
        <p class="text-sm text-base-content/60">
          No project named <code>{name}</code> is in the catalog.
        </p>
      </div>
    </div>
  {:else}
    <header class="card bg-base-100 shadow-sm">
      <div class="card-body gap-3 p-4 sm:flex-row sm:items-start">
        {#if project.logo}
          <img
            src={project.logo}
            alt=""
            class="h-16 w-16 shrink-0 rounded bg-base-200 object-contain"
          />
        {/if}
        <div class="min-w-0 flex-1 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-xl font-semibold tracking-tight">{project.title}</h1>
            <span class="font-mono text-sm text-base-content/60">{project.name}</span>
            {#if project.isAuto}
              <span
                class="badge badge-sm badge-primary badge-soft"
                title="ArchiveTeam's Choice: the tracker's own recommendation"
                >★ Recommended by Archive Team</span
              >
            {/if}
            {#if !project.active}
              <span class="badge badge-sm badge-ghost">retired</span>
            {/if}
            {#if timeLeft}
              <span
                class="badge badge-sm {timeLeft === 'closed'
                  ? 'badge-ghost'
                  : 'badge-warning badge-soft'}"
                title="Deadline {formatDateTime(project.deadline!)}"
              >
                Deadline: {timeLeft}
              </span>
            {/if}
          </div>
          {#if project.description}
            <p class="text-sm text-base-content/80">{project.description}</p>
          {/if}
          <div class="flex flex-wrap gap-3 text-sm">
            {#if project.leaderboard}
              <a
                class="link link-primary"
                href={project.leaderboard}
                target="_blank"
                rel="noreferrer">Leaderboard</a
              >
            {/if}
            {#if project.repository}
              <a
                class="link link-primary"
                href={project.repository}
                target="_blank"
                rel="noreferrer">Repository</a
              >
            {/if}
            <span class="text-base-content/60">
              Sampled {formatIsoAgo(project.lastSampledAt, fleet.now)}
            </span>
          </div>
          {#if project.lastError}
            <div role="alert" class="alert alert-warning alert-soft text-sm py-2">
              Last sample failed {formatIsoAgo(project.lastErrorAt, fleet.now)}: {project.lastError}
            </div>
          {/if}
        </div>
      </div>
    </header>

    <section class="card bg-base-100 shadow-sm" aria-labelledby="your-warriors">
      <div class="card-body gap-2 p-4">
        <h2 id="your-warriors" class="font-medium">
          Your warriors on this project
          <span class="text-base-content/50">({mine.length})</span>
        </h2>
        {#if mine.length === 0}
          <p class="text-sm text-base-content/60">
            None of your warriors is working on it right now.
          </p>
        {:else}
          <ul class="divide-y divide-base-200 text-sm">
            {#each mine as warrior (warrior.id)}
              <li class="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <a class="link link-hover font-medium" href={p('/')}>{warrior.name}</a>
                <span class="flex items-center gap-2 text-base-content/70">
                  {#if warrior.status}<span>{WARRIOR_STATUS_TEXT[warrior.status]}</span>{/if}
                  <span class="font-mono tabular-nums">{warrior.runningItems} running</span>
                  <span
                    class="badge badge-xs {warrior.connected
                      ? 'badge-success badge-soft'
                      : 'badge-ghost'}"
                  >
                    {warrior.connected ? 'connected' : 'offline'}
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    {#if project.tracker !== 'universal'}
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body text-sm text-base-content/70">
          This project runs on a different tracker, so there are no numbers to show yet.
        </div>
      </div>
    {:else}
      <div class="stats stats-vertical sm:stats-horizontal w-full bg-base-100 shadow-sm">
        <div class="stat">
          <div class="stat-title">To do</div>
          <div class="stat-value text-2xl">{formatCount(project.latest?.todo)}</div>
          <div class="stat-desc">
            {#if project.todo24h}
              24 h: {formatCount(project.todo24h.min)} to {formatCount(project.todo24h.max)}
            {:else}
              items waiting
            {/if}
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">Out</div>
          <div class="stat-value text-2xl">{formatCount(project.latest?.out)}</div>
          <div class="stat-desc">checked out to workers</div>
        </div>
        <div class="stat">
          <div class="stat-title">Done</div>
          <div class="stat-value text-2xl">{formatCount(project.latest?.done)}</div>
          <div class="stat-desc">{formatCount(project.latest?.downloaderCount)} downloaders</div>
        </div>
        <div class="stat">
          <div class="stat-title">Done per hour</div>
          <div class="stat-value text-2xl">{formatPerHour(project.doneRate.h1)}</div>
          <div class="stat-desc">
            6 h {formatPerHour(project.doneRate.h6)} · 24 h {formatPerHour(project.doneRate.h24)}
          </div>
        </div>
        <div class="stat">
          <div class="stat-title">Queue</div>
          <div class="stat-value text-2xl"><HealthBadge health={project.health} /></div>
          <div class="stat-desc">
            {#if project.todo24h}
              work available in {Math.round(project.todo24h.availability * 100)}% of samples
            {:else}
              no samples yet
            {/if}
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-sm">
        <div class="card-body gap-4 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 font-medium">
              History
              {#if history && historyLoading}
                <span
                  class="loading loading-spinner loading-xs"
                  role="status"
                  aria-label="Loading history"
                ></span>
              {/if}
            </h2>
            <div role="tablist" class="tabs tabs-box tabs-sm">
              {#each RANGES as option (option.value)}
                <button
                  role="tab"
                  class="tab {range === option.value ? 'tab-active' : ''}"
                  aria-selected={range === option.value}
                  onclick={() => (range = option.value)}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          </div>
          {#if historyError}
            <div role="alert" class="alert alert-error text-sm">
              <span>Could not load history: {historyError}</span>
              <button class="btn btn-sm" onclick={() => void loadHistory(name, range)}>Retry</button
              >
            </div>
          {:else if history === null && historyLoading}
            <div class="flex justify-center py-12">
              <span class="loading loading-dots loading-lg"></span>
            </div>
          {:else if history}
            <!-- The previous range stays visible, dimmed, until the new one arrives. -->
            <div
              class="grid gap-6 lg:grid-cols-2 {historyLoading ? 'opacity-60' : ''}"
              aria-busy={historyLoading}
            >
              <HistoryChart
                title="Items to do"
                points={todoSeries}
                color="var(--viz-todo)"
                format={formatCount}
              />
              <HistoryChart
                title="Items done per hour"
                points={rateSeries}
                color="var(--viz-done)"
                format={formatPerHour}
              />
            </div>
            <p class="text-xs text-base-content/50">
              {history.points.length}
              {history.resolution === 'raw' ? 'samples' : 'hourly points'} over the last {RANGES.find(
                (r) => r.value === history!.range,
              )?.label}.
            </p>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</section>
