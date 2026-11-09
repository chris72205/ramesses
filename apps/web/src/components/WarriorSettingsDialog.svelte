<script lang="ts">
  import { onMount } from 'svelte';
  import type { UpdateWarriorSettingsInput, WarriorSnapshot } from '@ramesses/shared';
  import { api, ApiError } from '../lib/api';
  import { notifications } from '../lib/notifications.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

  /**
   * Nickname and concurrency of one warrior, read from the warrior when the dialog opens and
   * written back on save. Nothing is cached: the warrior's own page may have changed them.
   * Errors stay in the dialog, next to the edits they concern; only a saved result closes it.
   */
  let { warrior, onclose }: { warrior: WarriorSnapshot; onclose: () => void } = $props();

  const CONCURRENCY = [1, 2, 3, 4, 5, 6];

  interface Values {
    downloader: string;
    concurrentItems: number;
  }

  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let fieldErrors = $state<Record<string, string>>({});
  let initial = $state<Values | null>(null);
  let downloader = $state('');
  let concurrentItems = $state(2);

  const changed = $derived(
    initial !== null &&
      (downloader !== initial.downloader || concurrentItems !== initial.concurrentItems),
  );

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const settings = await api.getSettings(warrior.id);
      downloader = settings.downloader ?? '';
      concurrentItems = settings.concurrentItems ?? 2;
      initial = { downloader, concurrentItems };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    if (!initial || !changed) return;
    const input: UpdateWarriorSettingsInput = {};
    if (downloader !== initial.downloader) input.downloader = downloader;
    if (concurrentItems !== initial.concurrentItems) input.concurrentItems = concurrentItems;
    saving = true;
    error = null;
    fieldErrors = {};
    try {
      await api.updateSettings(warrior.id, input);
      notifications.success(`Settings saved for ${warrior.name}`);
      onclose();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) fieldErrors = e.fields;
      else error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => void load());
</script>

<ConfirmDialog
  title="Settings for {warrior.name}"
  confirmLabel="Save"
  busy={saving}
  disabled={loading || !changed}
  onconfirm={() => void save()}
  oncancel={onclose}
>
  {#if loading}
    <div class="flex justify-center py-6">
      <span class="loading loading-spinner" role="status" aria-label="Loading settings"></span>
    </div>
  {:else}
    {#if error}
      <div role="alert" class="alert alert-error alert-soft py-2 text-sm">
        <span>{error}</span>
        {#if initial === null}
          <button type="button" class="btn btn-xs" onclick={() => void load()}>Retry</button>
        {/if}
      </div>
    {/if}
    {#if initial}
      <div class="flex flex-col gap-1">
        <label for="warrior-settings-downloader">Nickname</label>
        <input
          id="warrior-settings-downloader"
          class="input input-sm w-full {fieldErrors.downloader ? 'input-error' : ''}"
          bind:value={downloader}
          aria-invalid={fieldErrors.downloader ? 'true' : undefined}
          aria-describedby="warrior-settings-downloader-help"
        />
        {#if fieldErrors.downloader}
          <span class="text-xs text-error">{fieldErrors.downloader}</span>
        {/if}
        <span id="warrior-settings-downloader-help" class="text-xs text-base-content/60">
          Shown on the tracker leaderboards. 3 to 30 letters, digits, dashes, or underscores.
        </span>
      </div>
      <div class="flex flex-col gap-1">
        <label for="warrior-settings-concurrency">Concurrent items</label>
        <select
          id="warrior-settings-concurrency"
          class="select select-sm w-full {fieldErrors.concurrentItems ? 'select-error' : ''}"
          bind:value={concurrentItems}
          aria-describedby="warrior-settings-concurrency-help"
        >
          {#each CONCURRENCY as n (n)}
            <option value={n}>{n}</option>
          {/each}
        </select>
        {#if fieldErrors.concurrentItems}
          <span class="text-xs text-error">{fieldErrors.concurrentItems}</span>
        {/if}
        <span id="warrior-settings-concurrency-help" class="text-xs text-base-content/60">
          Items worked on at once, 1 to 6. The tracker budgets claims per nickname, so more is not
          always faster; the warrior default is 2.
        </span>
      </div>
    {/if}
  {/if}
</ConfirmDialog>
