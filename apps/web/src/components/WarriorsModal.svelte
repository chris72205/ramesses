<script lang="ts">
  import type { WarriorRecord } from '@ramesses/shared';
  import { api } from '../lib/api';
  import AddWarriorsForm from './AddWarriorsForm.svelte';

  let {
    open,
    records,
    onclose,
    onchange,
  }: { open: boolean; records: WarriorRecord[]; onclose: () => void; onchange: () => void } =
    $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let error = $state<string | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

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

<dialog bind:this={dialog} class="modal" {onclose}>
  <div class="modal-box max-w-2xl space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold">Manage warriors</h3>
      <form method="dialog">
        <button class="btn btn-sm btn-circle btn-ghost" aria-label="Close">✕</button>
      </form>
    </div>

    {#if records.length}
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
    {:else}
      <p class="text-sm text-base-content/60">No warriors configured.</p>
    {/if}

    {#if error}
      <div role="alert" class="alert alert-error text-sm"><span>{error}</span></div>
    {/if}

    <div class="divider my-0">Add</div>
    <AddWarriorsForm onadded={onchange} />
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
