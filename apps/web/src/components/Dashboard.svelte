<script lang="ts">
  import { fleet } from '../lib/fleet.svelte';
  import FleetSummary from './FleetSummary.svelte';
  import WarriorCard from './WarriorCard.svelte';
</script>

<header>
  <h1 class="text-xl font-semibold tracking-tight">Dashboard</h1>
  <p class="text-sm text-base-content/60">Live status and bandwidth of every warrior.</p>
</header>

<FleetSummary totals={fleet.totals} />

{#if !fleet.ready}
  <div class="flex justify-center py-24"><span class="loading loading-dots loading-lg"></span></div>
{:else if fleet.list.length === 0}
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body items-center text-center">
      <p>No warriors yet. Add some under <a class="link" href="/settings">Settings</a>.</p>
    </div>
  </div>
{:else}
  <div class="grid gap-4 grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
    {#each fleet.list as warrior (warrior.id)}
      <WarriorCard {warrior} now={fleet.now} />
    {/each}
  </div>
{/if}
