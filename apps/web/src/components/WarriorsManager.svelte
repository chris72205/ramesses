<script lang="ts">
  import type { WarriorRecord } from '@ramesses/shared';
  import { api } from '../lib/api';
  import { notifications } from '../lib/notifications.svelte';
  import AddWarriorsForm from './AddWarriorsForm.svelte';

  let { records, onchange }: { records: WarriorRecord[]; onchange: () => void } = $props();

  /** Runs one change to `record` and reports it; `done` is the past-tense outcome, such as "deleted". */
  async function run(
    record: WarriorRecord,
    action: () => Promise<unknown>,
    done: string,
  ): Promise<void> {
    try {
      await action();
      notifications.success(`${record.name} ${done}`);
      onchange();
    } catch (e) {
      notifications.error(`${record.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
</script>

<div class="space-y-4">
  {#if records.length}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Name</th>
            <th class="hidden sm:table-cell">Address</th>
            <th>Enabled</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each records as record (record.id)}
            {@const address = `${record.host}:${record.port}`}
            <tr>
              <td>
                <div class="font-medium">{record.name}</div>
                <!-- At phone width the address column is hidden, so it moves under the name. -->
                {#if record.name !== address}
                  <div class="font-mono text-xs text-base-content/60 sm:hidden">{address}</div>
                {/if}
              </td>
              <td class="hidden font-mono text-base-content/70 sm:table-cell">{address}</td>
              <td>
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-success"
                  checked={record.enabled}
                  aria-label="Enabled"
                  onchange={(event) => {
                    const enabled = event.currentTarget.checked;
                    void run(
                      record,
                      () => api.updateWarrior(record.id, { enabled }),
                      enabled ? 'enabled' : 'disabled',
                    );
                  }}
                />
              </td>
              <td class="text-right whitespace-nowrap">
                <button
                  class="btn btn-ghost btn-xs text-error"
                  onclick={() => void run(record, () => api.deleteWarrior(record.id), 'deleted')}
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

  <div class="divider my-0">Add</div>
  <AddWarriorsForm onadded={onchange} />
</div>
