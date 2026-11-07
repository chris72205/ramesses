<script lang="ts">
  import type { WarriorRecord } from '@ramesses/shared';
  import { api } from '../lib/api';
  import AddWarriorsForm from './AddWarriorsForm.svelte';

  let {
    records,
    onchange,
    ondone,
  }: { records: WarriorRecord[]; onchange: () => void; ondone: () => void } = $props();

  async function remove(id: string): Promise<void> {
    await api.deleteWarrior(id);
    onchange();
  }
</script>

<div class="mx-auto max-w-2xl space-y-4">
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body gap-4">
      <div>
        <h1 class="card-title text-2xl">Add your warriors</h1>
        <p class="text-base-content/70">
          Enter the address of each Archive Team Warrior's web interface. The port defaults to 8001.
          You can change this list later from <strong>Manage warriors</strong>.
        </p>
      </div>
      <AddWarriorsForm onadded={onchange} />
    </div>
  </div>

  {#if records.length}
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body gap-3">
        <h2 class="card-title text-base">Added ({records.length})</h2>
        <ul class="divide-y divide-base-200">
          {#each records as record (record.id)}
            <li class="flex items-center justify-between gap-2 py-2 text-sm">
              <span
                ><strong>{record.name}</strong>
                <span class="font-mono text-base-content/60">{record.host}:{record.port}</span
                ></span
              >
              <button class="btn btn-ghost btn-xs" onclick={() => void remove(record.id)}
                >Remove</button
              >
            </li>
          {/each}
        </ul>
        <div class="card-actions justify-end">
          <button class="btn btn-primary" onclick={ondone}>Open dashboard</button>
        </div>
      </div>
    </div>
  {/if}
</div>
