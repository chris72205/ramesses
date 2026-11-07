<script lang="ts">
  import { fleet } from '../lib/fleet.svelte';
  import FleetSummary from './FleetSummary.svelte';
  import WarriorCard from './WarriorCard.svelte';
</script>

<FleetSummary totals={fleet.totals} />

{#if !fleet.ready}
  <div class="flex justify-center py-24"><span class="loading loading-dots loading-lg"></span></div>
{:else if fleet.list.length === 0}
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body items-center text-center">
      <p>No warriors yet. Use <strong>Manage warriors</strong> to add some.</p>
    </div>
  </div>
{:else}
  <div class="grid gap-4 grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
    {#each fleet.list as warrior (warrior.id)}
      <WarriorCard {warrior} now={fleet.now} />
    {/each}
  </div>
{/if}
