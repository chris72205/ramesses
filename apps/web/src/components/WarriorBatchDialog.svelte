<script module lang="ts">
  import type { WarriorSnapshot } from '@ramesses/shared';

  /** One warrior the dialog offers, with why it can or cannot take part. */
  export interface BatchRow {
    warrior: WarriorSnapshot;
    eligible: boolean;
    note: string;
  }
</script>

<script lang="ts">
  import { controls } from '../lib/controls.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

  /**
   * Pick warriors and send one control request to each, one at a time, reporting per row whether
   * the warrior accepted. The pending state of each warrior shows on its card through the
   * controls store; this dialog only shows the request outcome.
   */
  let {
    title,
    verb,
    rows,
    defaultChecked = false,
    footnote,
    emptyText,
    run,
    onclose,
  }: {
    title: string;
    /** the confirm button reads "<verb> N warrior(s)" */
    verb: string;
    rows: BatchRow[];
    /** whether eligible rows start checked */
    defaultChecked?: boolean;
    footnote: string;
    /** shown instead of the list when there is no row at all */
    emptyText: string;
    /** sends the request for one warrior; resolves to true when it was accepted */
    run: (warrior: WarriorSnapshot) => Promise<boolean>;
    onclose: () => void;
  } = $props();

  type Result = { state: 'running' } | { state: 'ok' } | { state: 'failed'; message: string };

  // Only explicit toggles are stored, so a row that appears while the dialog is open starts at
  // the default like the others.
  let toggled = $state<Record<string, boolean>>({});
  let results = $state<Record<string, Result>>({});
  let running = $state(false);
  let done = $state(false);

  const isChecked = (row: BatchRow): boolean =>
    row.eligible && (toggled[row.warrior.id] ?? defaultChecked);
  const count = $derived(rows.filter(isChecked).length);

  async function start(): Promise<void> {
    running = true;
    for (const row of rows) {
      if (!isChecked(row)) continue;
      results[row.warrior.id] = { state: 'running' };
      const ok = await run(row.warrior);
      // The store keeps the server's message for the card; the row repeats it.
      results[row.warrior.id] = ok
        ? { state: 'ok' }
        : { state: 'failed', message: controls.errors[row.warrior.id] ?? 'Request failed' };
    }
    running = false;
    done = true;
  }
</script>

<ConfirmDialog
  {title}
  confirmLabel={done ? 'Close' : `${verb} ${count} warrior${count === 1 ? '' : 's'}`}
  cancelLabel={done ? null : 'Cancel'}
  busy={running}
  disabled={!done && count === 0}
  onconfirm={done ? onclose : () => void start()}
  oncancel={onclose}
>
  {#if rows.length === 0}
    <p class="text-base-content/60">{emptyText}</p>
  {:else}
    <ul class="divide-y divide-base-200">
      {#each rows as row (row.warrior.id)}
        {@const result = results[row.warrior.id]}
        <li class="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            aria-label="{verb} {row.warrior.name}"
            disabled={!row.eligible || running || done}
            checked={isChecked(row)}
            onchange={(event) => (toggled[row.warrior.id] = event.currentTarget.checked)}
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{row.warrior.name}</span>
            <span class="block truncate text-xs text-base-content/60">
              {#if result?.state === 'failed'}
                <span class="text-error">{result.message}</span>
              {:else}
                {row.note}
              {/if}
            </span>
          </span>
          {#if result?.state === 'running'}
            <span class="loading loading-spinner loading-xs" role="status" aria-label="Sending"
            ></span>
          {:else if result?.state === 'ok'}
            <span class="badge badge-xs badge-success badge-soft">accepted</span>
          {:else if result?.state === 'failed'}
            <span class="badge badge-xs badge-error badge-soft">failed</span>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="text-xs text-base-content/60">{footnote}</p>
  {/if}
</ConfirmDialog>
