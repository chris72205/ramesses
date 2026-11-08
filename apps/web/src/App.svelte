<script lang="ts">
  import { onMount } from 'svelte';
  import { isActiveLink, Router } from 'sv-router';
  import { fleet } from './lib/fleet.svelte';
  import { p } from './lib/router';
  import { warriors } from './lib/warriors.svelte';
  import SetupView from './components/SetupView.svelte';
  import SocketBadge from './components/SocketBadge.svelte';

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
  <header class="navbar sticky top-0 z-30 bg-base-100/95 backdrop-blur shadow-sm px-4">
    <div class="flex-1 items-center gap-4">
      <div class="flex items-baseline gap-3">
        <span class="text-xl font-semibold tracking-tight">Ramesses</span>
        <span class="text-sm text-base-content/60 hidden md:inline">Archive Team Warrior fleet</span
        >
      </div>
      {#if !setupActive}
        <nav aria-label="Sections">
          <div role="tablist" class="tabs tabs-border tabs-sm">
            {#each TABS as tab (tab.href)}
              <a
                role="tab"
                class="tab"
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
    <div class="flex items-center gap-3">
      <SocketBadge state={fleet.socket} />
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
</div>
