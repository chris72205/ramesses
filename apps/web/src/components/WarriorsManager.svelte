<script lang="ts">
  import type { WarriorRecord } from '@ramesses/shared';
  import { api } from '../lib/api';
  import AddWarriorsForm from './AddWarriorsForm.svelte';

  let { records, onchange }: { records: WarriorRecord[]; onchange: () => void } = $props();

  let error = $state<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    error = null;
    try {
      await action();
      onchange();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="space-y-4">
  {#if records.length}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr><th>Name</th><th>Address</th><th>Enabled</th><th></th></tr>
        </thead>
        <tbody>
          {#each records as record (record.id)}
            <tr>
              <td class="font-medium">{record.name}</td>
              <td class="font-mono text-base-content/70">{record.host}:{record.port}</td>
              <td>
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-success"
                  checked={record.enabled}
                  aria-label="Enabled"
                  onchange={(event) =>
                    void run(() =>
                      api.updateWarrior(record.id, { enabled: event.currentTarget.checked }),
                    )}
                />
              </td>
              <td class="text-right">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => void run(() => api.deleteWarrior(record.id))}
                >
                  Delete
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="text-sm text-base-content/60">No warriors configured.</p>
  {/if}

  {#if error}
    <div role="alert" class="alert alert-error text-sm"><span>{error}</span></div>
  {/if}

  <div class="divider my-0">Add</div>
  <AddWarriorsForm onadded={onchange} />
</div>
