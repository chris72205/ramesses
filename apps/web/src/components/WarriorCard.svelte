<script lang="ts">
  import { WARRIOR_STATUS_TEXT, type WarriorSnapshot } from '@ramesses/shared';
  import { type ControlResult, controls } from '../lib/controls.svelte';
  import { dashboardPreferences } from '../lib/dashboard-preferences.svelte';
  import { formatAgo, formatBytes, formatPerHour, formatRate, formatWindow } from '../lib/format';
  import { notifications } from '../lib/notifications.svelte';
  import { projects } from '../lib/projects.svelte';
  import BandwidthSparkline from './BandwidthSparkline.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import ConnectionBadge from './ConnectionBadge.svelte';
  import ItemRow from './ItemRow.svelte';
  import ProjectPicker from './ProjectPicker.svelte';
  import WarriorSettingsDialog from './WarriorSettingsDialog.svelte';

  let { warrior, now }: { warrior: WarriorSnapshot; now: number } = $props();

  const live = $derived(warrior.enabled && warrior.connection.state === 'connected');
  const pending = $derived(controls.pending[warrior.id] ?? null);
  // A warrior that is shutting down or rebooting on its own cannot take a new project.
  const canStop = $derived(
    warrior.project !== null &&
      warrior.status !== 'SHUTTING_DOWN' &&
      warrior.status !== 'REBOOTING',
  );

  $effect(() => controls.settle(warrior));

  type Dialog = 'project' | 'stop' | 'settings';
  let dialog = $state<Dialog | null>(null);
  let pickedProject = $state<string | null>(null);

  function openDialog(kind: Dialog): void {
    // The actions menu opens on focus; moving focus away closes it behind the dialog.
    (document.activeElement as HTMLElement | null)?.blur();
    pickedProject = null;
    dialog = kind;
  }

  // The dialog closes before the request goes out; the card shows the pending state and a toast
  // reports whether the warrior accepted.
  async function switchProject(): Promise<void> {
    const name = pickedProject;
    dialog = null;
    if (!name) return;
    const title = warrior.catalog[name]?.title ?? name;
    report(await controls.selectProject(warrior, name), `Switching ${warrior.name} to ${title}`);
  }

  async function stopWorking(): Promise<void> {
    dialog = null;
    report(await controls.deselectProject(warrior), `Stopping work on ${warrior.name}`);
  }

  function report(result: ControlResult, accepted: string): void {
    if (result.accepted) notifications.success(accepted);
    else notifications.error(`${warrior.name}: ${result.error}`);
  }
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
  const address = $derived(`${warrior.host}:${warrior.port}`);
  const average = $derived(
    warrior.bandwidth && warrior.rolling && warrior.rolling.samples > 0 ? warrior.rolling : null,
  );
  const showInProgress = $derived(!dashboardPreferences.showItems && warrior.project !== null);
  // The same figure as the Projects page's one-hour column.
  const donePerHour = $derived(
    projects.byName.get(warrior.project?.name ?? '')?.doneRate.h1 ?? null,
  );
</script>

<!--
  Cards in a grid row share a height. daisyUI lets every <p> in a card body grow to fill it, which
  would open a blank block mid-card, so the paragraphs here stay at their size and the footer takes
  the slack instead.
-->
<article class="card bg-base-100 shadow-sm {live ? '' : 'opacity-70'}">
  <div class="card-body gap-3 p-4">
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="card-title block truncate text-base leading-tight" title={warrior.name}>
          {warrior.name}
        </h2>
        <!-- An unnamed warrior is already titled by its address, so the link says what it does. -->
        <a
          class="link link-hover text-xs text-base-content/60 {warrior.name === address
            ? ''
            : 'font-mono'}"
          href="http://{address}/"
          target="_blank"
          rel="noreferrer"
          title="Open the warrior's own web interface in a new tab"
          >{warrior.name === address ? 'Open warrior interface ↗' : address}</a
        >
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        {#if warrior.status}
          <span class="badge badge-sm {statusLook}" title={warrior.status}>
            {WARRIOR_STATUS_TEXT[warrior.status]}
          </span>
        {/if}
        <ConnectionBadge connection={warrior.connection} enabled={warrior.enabled} {now} />
        {#if live}
          <div class="dropdown dropdown-end">
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              aria-label="Actions for {warrior.name}"
              aria-haspopup="menu"
              disabled={pending !== null}>⋯</button
            >
            <ul
              class="dropdown-content menu menu-sm z-20 mt-1 w-44 rounded-box bg-base-100 p-1 shadow"
              role="menu"
            >
              <li>
                <button type="button" role="menuitem" onclick={() => openDialog('project')}
                  >Change project…</button
                >
              </li>
              {#if canStop}
                <li>
                  <button type="button" role="menuitem" onclick={() => openDialog('stop')}
                    >Stop working</button
                  >
                </li>
              {/if}
              <li>
                <button type="button" role="menuitem" onclick={() => openDialog('settings')}
                  >Settings…</button
                >
              </li>
            </ul>
          </div>
        {/if}
      </div>
    </header>

    {#if !warrior.enabled}
      <p class="grow-0 text-sm text-base-content/60">
        Disabled. Enable it under Settings to collect data.
      </p>
    {:else if warrior.connection.state !== 'connected' && warrior.connection.lastError}
      <p class="grow-0 text-sm text-warning">
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
            class="size-8 shrink-0 rounded bg-base-200 object-contain"
            loading="lazy"
          />
        {/if}
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            {#if warrior.project.name}
              <!-- A plain href: the router intercepts it, and importing the router here would
                   create a cycle (router -> Dashboard -> WarriorCard -> router). -->
              <a
                class="link link-hover font-medium truncate"
                href="/projects/{encodeURIComponent(warrior.project.name)}"
                title="Open the project page">{warrior.project.title}</a
              >
            {:else}
              <span class="font-medium truncate">{warrior.project.title}</span>
            {/if}
            {#if donePerHour !== null}
              <span
                class="tooltip shrink-0 cursor-help text-xs text-base-content/60 hover:before:delay-800 hover:after:delay-800"
                data-tip="Items completed per hour by everyone working on this project, over the last hour. From the tracker, not this warrior."
                >{formatPerHour(donePerHour)}</span
              >
            {/if}
            {#if warrior.runnerStatus === 'stopping'}
              <span class="badge badge-xs badge-warning">stopping</span>
            {/if}
          </div>
          <div class="text-xs text-base-content/60 flex gap-2">
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

    {#if pending}
      <p class="flex grow-0 items-center gap-2 text-sm text-info" role="status">
        <span class="loading loading-spinner loading-xs"></span>
        {pending.label}
      </p>
    {/if}

    {#if dashboardPreferences.showItems && live && warrior.project && warrior.items.length === 0}
      <p class="grow-0 text-sm text-base-content/60">No items in flight.</p>
    {/if}

    {#if warrior.bandwidth}
      <div class="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-3">
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
    {/if}

    {#if average || showInProgress}
      <!-- The count sits at the right edge and wraps below the average when the row runs out of room. -->
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
        {#if average}
          <p
            class="grow-0 text-base-content/60"
            title="{average.samples} samples; peak ↓ {formatRate(
              average.peakReceiving,
            )} ↑ {formatRate(average.peakSending)}"
          >
            {formatWindow(average.windowMs)} average:
            <span class="font-mono tabular-nums">↓ {formatRate(average.avgReceiving)}</span>
            <span class="font-mono tabular-nums">↑ {formatRate(average.avgSending)}</span>
          </p>
        {/if}
        {#if showInProgress}
          <span class="font-medium tabular-nums whitespace-nowrap">{runningItems} in progress</span>
        {/if}
      </div>
    {/if}

    {#if dashboardPreferences.showItems && warrior.items.length}
      <ul class="divide-y divide-base-200 -mx-1">
        {#each warrior.items as item (item.id)}
          <ItemRow {item} {now} />
        {/each}
      </ul>
    {/if}

    <footer class="mt-auto flex flex-wrap justify-between gap-2 text-xs text-base-content/50">
      <span>
        {warrior.counters.completed} completed · {warrior.counters.failed} failed
        {#if warrior.counters.canceled}· {warrior.counters.canceled} canceled{/if}
      </span>
      {#if warrior.broadcastMessage}
        <span class="min-w-0 max-w-full truncate" title={warrior.broadcastMessage}
          >Announcement: {warrior.broadcastMessage}</span
        >
      {/if}
    </footer>
  </div>
</article>

{#if dialog === 'project'}
  <ConfirmDialog
    title="Change project for {warrior.name}"
    confirmLabel="Switch project"
    disabled={pickedProject === null || pickedProject === warrior.project?.name}
    onconfirm={() => void switchProject()}
    oncancel={() => (dialog = null)}
  >
    <ProjectPicker
      catalog={warrior.catalog}
      current={warrior.project?.name ?? null}
      bind:selected={pickedProject}
    />
    <p class="text-xs text-base-content/60">
      Items in flight finish on the current project before the switch.
    </p>
  </ConfirmDialog>
{:else if dialog === 'stop'}
  <ConfirmDialog
    title="Stop working on {warrior.project?.title}?"
    confirmLabel="Stop working"
    onconfirm={() => void stopWorking()}
    oncancel={() => (dialog = null)}
  >
    <p>
      Finishes the items in flight, then leaves the warrior idle. It stays up and picks up nothing
      new until you choose a project.
    </p>
  </ConfirmDialog>
{:else if dialog === 'settings'}
  <WarriorSettingsDialog {warrior} onclose={() => (dialog = null)} />
{/if}
