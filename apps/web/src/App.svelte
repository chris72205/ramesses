<script lang="ts">
  import { onMount } from 'svelte';
  import { isActiveLink, Router } from 'sv-router';
  import type { WarriorRecord } from '@ramesses/shared';
  import { api } from './lib/api';
  import { fleet } from './lib/fleet.svelte';
  import { p } from './lib/router';
  import SetupView from './components/SetupView.svelte';
  import SocketBadge from './components/SocketBadge.svelte';
  import WarriorsModal from './components/WarriorsModal.svelte';

  let records = $state<WarriorRecord[] | null>(null);
  let loadError = $state<string | null>(null);
  let setupActive = $state(false);
  let manageOpen = $state(false);

  async function refresh(): Promise<void> {
    try {
      records = await api.listWarriors();
      loadError = null;
      if (records.length === 0) setupActive = true;
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  onMount(() => {
    fleet.start();
    void refresh();
    return () => fleet.stop();
  });
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
            <a
              role="tab"
              class="tab"
              href={p('/')}
              {@attach isActiveLink({ className: 'tab-active' })}
            >
              Dashboard
            </a>
            <a
              role="tab"
              class="tab"
              href={p('/projects')}
              {@attach isActiveLink({ className: 'tab-active', startsWith: true })}
            >
              Projects
            </a>
          </div>
        </nav>
      {/if}
    </div>
    <div class="flex items-center gap-3">
      <SocketBadge state={fleet.socket} />
      {#if !setupActive}
        <button class="btn btn-sm btn-outline" onclick={() => (manageOpen = true)}>
          Manage warriors
        </button>
      {/if}
    </div>
  </header>

  <main class="mx-auto max-w-screen-2xl p-4 space-y-4">
    {#if loadError}
      <div role="alert" class="alert alert-error">
        <span>Could not reach the backend: {loadError}</span>
        <button class="btn btn-sm" onclick={() => void refresh()}>Retry</button>
      </div>
    {:else if records === null}
      <div class="flex justify-center py-24">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if setupActive}
      <SetupView {records} onchange={() => void refresh()} ondone={() => (setupActive = false)} />
    {:else}
      <Router />
    {/if}
  </main>

  <WarriorsModal
    open={manageOpen}
    records={records ?? []}
    onclose={() => (manageOpen = false)}
    onchange={() => void refresh()}
  />
</div>
