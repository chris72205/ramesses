<script lang="ts">
  import { WARRIOR_STATUS_TEXT, type WarriorSnapshot } from '@ramesses/shared';
  import { formatAgo, formatBytes, formatRate, formatWindow } from '../lib/format';
  import BandwidthSparkline from './BandwidthSparkline.svelte';
  import ConnectionBadge from './ConnectionBadge.svelte';
  import ItemRow from './ItemRow.svelte';

  let { warrior, now }: { warrior: WarriorSnapshot; now: number } = $props();

  const live = $derived(warrior.enabled && warrior.connection.state === 'connected');
  const statusLook = $derived.by(() => {
    switch (warrior.status) {
      case 'RUNNING_PROJECT':
        return 'badge-success badge-soft';
      case 'STARTING_PROJECT':
      case 'SWITCHING_PROJECT':
      case 'RESTARTING_PROJECT':
        return 'badge-info badge-soft';
      case 'NO_PROJECT':
      case 'INVALID_SETTINGS':
      case 'UNINITIALIZED':
        return 'badge-warning badge-soft';
      case 'STOPPING_PROJECT':
      case 'SHUTTING_DOWN':
      case 'REBOOTING':
        return 'badge-error badge-soft';
      default:
        return 'badge-ghost';
    }
  });
  const runningItems = $derived(warrior.items.filter((i) => i.status === 'running').length);
</script>

<article class="card bg-base-100 shadow-sm {live ? '' : 'opacity-70'}">
  <div class="card-body gap-3 p-4">
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="card-title text-base leading-tight">{warrior.name}</h2>
        <a
          class="link link-hover text-xs text-base-content/60 font-mono"
          href="http://{warrior.host}:{warrior.port}/"
          target="_blank"
          rel="noreferrer"
          title="Open the warrior's own web interface in a new tab">{warrior.host}:{warrior.port}</a
        >
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        {#if warrior.status}
          <span class="badge badge-sm {statusLook}" title={warrior.status}>
            {WARRIOR_STATUS_TEXT[warrior.status]}
          </span>
        {/if}
        <ConnectionBadge connection={warrior.connection} enabled={warrior.enabled} {now} />
      </div>
    </header>

    {#if !warrior.enabled}
      <p class="text-sm text-base-content/60">
        Disabled. Enable it from Manage warriors to collect data.
      </p>
    {:else if warrior.connection.state !== 'connected' && warrior.connection.lastError}
      <p class="text-sm text-warning">
        {warrior.connection.lastError}
        <span class="text-base-content/50"
          >· last message {formatAgo(warrior.connection.lastSeenAt, now)}</span
        >
      </p>
    {/if}

    {#if warrior.project}
      <div class="flex items-center gap-3 rounded-box bg-base-200 px-3 py-2">
        {#if warrior.project.logo}
          <img
            src={warrior.project.logo}
            alt=""
            class="size-8 shrink-0 rounded object-contain"
            loading="lazy"
          />
        {/if}
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium truncate">{warrior.project.title}</span>
            {#if warrior.runnerStatus === 'stopping'}
              <span class="badge badge-xs badge-warning">stopping</span>
            {/if}
          </div>
          <div class="text-xs text-base-content/60 flex gap-2">
            <span>{runningItems} item{runningItems === 1 ? '' : 's'} running</span>
            {#if warrior.project.leaderboard}
              <a
                class="link link-hover"
                href={warrior.project.leaderboard}
                target="_blank"
                rel="noreferrer">Leaderboard</a
              >
            {/if}
          </div>
        </div>
      </div>
    {:else if live}
      <div class="rounded-box bg-base-200 px-3 py-2 text-sm text-base-content/60">
        No project selected.
      </div>
    {/if}

    {#if warrior.bandwidth}
      <div class="grid grid-cols-[auto_1fr] items-center gap-3">
        <dl class="text-sm space-y-1 whitespace-nowrap">
          <div class="flex items-center gap-2">
            <span class="inline-block h-0.5 w-3 rounded" style="background: var(--viz-down)"></span>
            <dt class="text-base-content/60 w-10">Down</dt>
            <dd class="font-mono tabular-nums">{formatRate(warrior.bandwidth.receiving)}</dd>
            <dd class="text-xs text-base-content/50">{formatBytes(warrior.bandwidth.received)}</dd>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-block h-0.5 w-3 rounded" style="background: var(--viz-up)"></span>
            <dt class="text-base-content/60 w-10">Up</dt>
            <dd class="font-mono tabular-nums">{formatRate(warrior.bandwidth.sending)}</dd>
            <dd class="text-xs text-base-content/50">{formatBytes(warrior.bandwidth.sent)}</dd>
          </div>
        </dl>
        <BandwidthSparkline history={warrior.bandwidthHistory} />
      </div>
      {#if warrior.rolling && warrior.rolling.samples > 0}
        <p
          class="text-xs text-base-content/60"
          title="{warrior.rolling.samples} samples; peak ↓ {formatRate(
            warrior.rolling.peakReceiving,
          )} ↑ {formatRate(warrior.rolling.peakSending)}"
        >
          {formatWindow(warrior.rolling.windowMs)} average:
          <span class="font-mono tabular-nums">↓ {formatRate(warrior.rolling.avgReceiving)}</span>
          <span class="font-mono tabular-nums">↑ {formatRate(warrior.rolling.avgSending)}</span>
        </p>
      {/if}
    {/if}

    {#if warrior.items.length}
      <ul class="divide-y divide-base-200 -mx-1">
        {#each warrior.items as item (item.id)}
          <ItemRow {item} {now} />
        {/each}
      </ul>
    {/if}

    <footer class="flex flex-wrap justify-between gap-2 text-xs text-base-content/50">
      <span>
        {warrior.counters.completed} completed · {warrior.counters.failed} failed
        {#if warrior.counters.canceled}· {warrior.counters.canceled} canceled{/if}
      </span>
      {#if warrior.broadcastMessage}
        <span class="truncate" title={warrior.broadcastMessage}
          >Announcement: {warrior.broadcastMessage}</span
        >
      {/if}
    </footer>
  </div>
</article>
