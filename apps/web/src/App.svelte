<script lang="ts">
  import { onMount } from 'svelte';
  import { isActiveLink, Router } from 'sv-router';
  import { fleet } from './lib/fleet.svelte';
  import { p } from './lib/router';
  import { warriors } from './lib/warriors.svelte';
  import SetupView from './components/SetupView.svelte';
  import SocketBadge from './components/SocketBadge.svelte';
  import Toasts from './components/Toasts.svelte';

  /** First-run setup takes over the whole page until at least one warrior exists. */
  let setupActive = $state(false);

  $effect(() => {
    if (warriors.records?.length === 0) setupActive = true;
  });

  onMount(() => {
    fleet.start();
    void warriors.load();
    return () => fleet.stop();
  });

  const TABS = [
    { href: p('/'), label: 'Dashboard', startsWith: false },
    { href: p('/projects'), label: 'Projects', startsWith: true },
    { href: p('/settings'), label: 'Settings', startsWith: true },
  ];
</script>

<div class="min-h-screen bg-base-200">
  <!--
    Two aligned rows: brand and the socket badge share a baseline, and the section tabs sit on
    their own full-width row whose active underline meets the header's bottom edge. The inner
    container matches <main>, so tabs line up with the page content at every width.
  -->
  <header class="sticky top-0 z-30 bg-base-100/95 shadow-sm backdrop-blur">
    <div class="mx-auto max-w-screen-2xl px-4">
      <div class="flex h-14 items-center justify-between gap-4">
        <div class="flex min-w-0 items-baseline gap-3">
          <span class="text-xl font-semibold tracking-tight">Ramesses</span>
          <span class="hidden truncate text-sm text-base-content/60 sm:inline"
            >Archive Team Warrior fleet</span
          >
        </div>
        <SocketBadge state={fleet.socket} />
      </div>
      {#if !setupActive}
        <nav aria-label="Sections" class="-mb-px">
          <div role="tablist" class="tabs tabs-border">
            {#each TABS as tab (tab.href)}
              <a
                role="tab"
                class="tab h-10 flex-1 px-4 sm:flex-none"
                href={tab.href}
                {@attach isActiveLink({ className: 'tab-active', startsWith: tab.startsWith })}
              >
                {tab.label}
              </a>
            {/each}
          </div>
        </nav>
      {/if}
    </div>
  </header>

  <main class="mx-auto max-w-screen-2xl p-4 space-y-4">
    {#if warriors.error}
      <div role="alert" class="alert alert-error">
        <span>Could not reach the backend: {warriors.error}</span>
        <button class="btn btn-sm" onclick={() => void warriors.load()}>Retry</button>
      </div>
    {:else if warriors.records === null}
      <div class="flex justify-center py-24">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if setupActive}
      <SetupView
        records={warriors.records}
        onchange={() => void warriors.load()}
        ondone={() => (setupActive = false)}
      />
    {:else}
      <Router />
    {/if}
  </main>
  <Toasts />
</div>
