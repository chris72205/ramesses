<script lang="ts">
  import { onMount } from 'svelte';
  import type { WarriorRecord } from '@ramesses/shared';
  import { api } from './lib/api';
  import { fleet } from './lib/fleet.svelte';
  import Dashboard from './components/Dashboard.svelte';
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
    <div class="flex-1 gap-3">
      <span class="text-xl font-semibold tracking-tight">Ramesses</span>
      <span class="text-sm text-base-content/60 hidden sm:inline">Archive Team Warrior fleet</span>
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
      <Dashboard />
    {/if}
  </main>

  <WarriorsModal
    open={manageOpen}
    records={records ?? []}
    onclose={() => (manageOpen = false)}
    onchange={() => void refresh()}
  />
</div>
