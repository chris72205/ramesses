<script lang="ts">
  import type { WarriorSnapshot } from '@ramesses/shared';
  import { controls } from '../lib/controls.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

  /**
   * Pick connected warriors to move onto one project. Requests go out one at a time and each
   * row reports whether its warrior accepted.
   */
  let {
    project,
    warriors,
    onclose,
  }: {
    project: { name: string; title: string };
    warriors: WarriorSnapshot[];
    onclose: () => void;
  } = $props();

  type Result = { state: 'running' } | { state: 'ok' } | { state: 'failed'; message: string };

  const rows = $derived(
    warriors
      .filter((w) => w.enabled && w.connection.state === 'connected')
      .map((warrior) => {
        if (warrior.project?.name === project.name) {
          return { warrior, eligible: false, note: 'Already on this project' };
        }
        if (!warrior.catalog[project.name]) {
          return { warrior, eligible: false, note: 'Not in this warrior’s project list' };
        }
        return {
          warrior,
          eligible: true,
          note: warrior.project ? `Now on ${warrior.project.title}` : 'Idle',
        };
      }),
  );

  let checked = $state<Record<string, boolean>>({});
  let results = $state<Record<string, Result>>({});
  let running = $state(false);
  let done = $state(false);

  const count = $derived(rows.filter((r) => r.eligible && checked[r.warrior.id]).length);

  async function run(): Promise<void> {
    running = true;
    for (const row of rows) {
      if (!row.eligible || !checked[row.warrior.id]) continue;
      results[row.warrior.id] = { state: 'running' };
      const ok = await controls.selectProject(row.warrior, project.name);
      results[row.warrior.id] = ok
        ? { state: 'ok' }
        : { state: 'failed', message: controls.errors[row.warrior.id] ?? 'Request failed' };
    }
    running = false;
    done = true;
  }
</script>

<ConfirmDialog
  title="Run {project.title} on…"
  confirmLabel={done ? 'Close' : `Run on ${count} warrior${count === 1 ? '' : 's'}`}
  cancelLabel={done ? null : 'Cancel'}
  busy={running}
  disabled={!done && count === 0}
  onconfirm={done ? onclose : () => void run()}
  oncancel={onclose}
>
  {#if rows.length === 0}
    <p class="text-base-content/60">No warrior is connected right now.</p>
  {:else}
    <ul class="divide-y divide-base-200">
      {#each rows as row (row.warrior.id)}
        {@const result = results[row.warrior.id]}
        <li class="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            aria-label="Run on {row.warrior.name}"
            disabled={!row.eligible || running || done}
            bind:checked={checked[row.warrior.id]}
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
    <p class="text-xs text-base-content/60">
      Items in flight finish on the current project before the switch.
    </p>
  {/if}
</ConfirmDialog>
