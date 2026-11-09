<script module lang="ts">
  import type { WarriorSnapshot } from '@ramesses/shared';
  import { pluralize } from '../lib/format';

  /** One warrior the dialog offers, with why it can or cannot take part. */
  export interface BatchRow {
    warrior: WarriorSnapshot;
    eligible: boolean;
    note: string;
  }

  /**
   * The one line that reports a batch: "Telegram requested on 3 warriors", with the failures
   * listed when some warriors turned the request down, or "Stop failed on 2 warriors: …" when
   * all of them did.
   */
  export function summarizeBatch(subject: string, accepted: number, failures: string[]): string {
    if (failures.length === 0) return `${subject} requested on ${pluralize(accepted, 'warrior')}`;
    const list = failures.join('; ');
    if (accepted === 0) {
      return `${subject} failed on ${pluralize(failures.length, 'warrior')}: ${list}`;
    }
    return `${subject} requested on ${pluralize(accepted, 'warrior')} (${failures.length} failed: ${list})`;
  }
</script>

<script lang="ts">
  import type { ControlResult } from '../lib/controls.svelte';
  import { notifications } from '../lib/notifications.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';

  /**
   * Pick warriors and send one control request to each. The dialog closes as soon as the run is
   * confirmed: each warrior's card shows its pending state through the controls store, and one
   * toast sums up which warriors accepted once the last request has been answered.
   */
  let {
    title,
    verb,
    subject,
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
    /** what the summary toast says was requested, such as the project title or "Stop" */
    subject: string;
    rows: BatchRow[];
    /** whether eligible rows start checked */
    defaultChecked?: boolean;
    footnote: string;
    /** shown instead of the list when there is no row at all */
    emptyText: string;
    /** sends the request for one warrior */
    run: (warrior: WarriorSnapshot) => Promise<ControlResult>;
    onclose: () => void;
  } = $props();

  // Only explicit toggles are stored, so a row that appears while the dialog is open starts at
  // the default like the others.
  let toggled = $state<Record<string, boolean>>({});

  const isChecked = (row: BatchRow): boolean =>
    row.eligible && (toggled[row.warrior.id] ?? defaultChecked);
  const count = $derived(rows.filter(isChecked).length);

  async function start(): Promise<void> {
    const chosen = rows.filter(isChecked).map((row) => row.warrior);
    onclose();
    const failures: string[] = [];
    for (const warrior of chosen) {
      const result = await run(warrior);
      if (!result.accepted) failures.push(`${warrior.name}: ${result.error}`);
    }
    const message = summarizeBatch(subject, chosen.length - failures.length, failures);
    if (failures.length === 0) notifications.success(message);
    else notifications.error(message);
  }
</script>

<ConfirmDialog
  {title}
  confirmLabel="{verb} {pluralize(count, 'warrior')}"
  disabled={count === 0}
  onconfirm={() => void start()}
  oncancel={onclose}
>
  {#if rows.length === 0}
    <p class="text-base-content/60">{emptyText}</p>
  {:else}
    <ul class="divide-y divide-base-200">
      {#each rows as row (row.warrior.id)}
        <li class="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            aria-label="{verb} {row.warrior.name}"
            disabled={!row.eligible}
            checked={isChecked(row)}
            onchange={(event) => (toggled[row.warrior.id] = event.currentTarget.checked)}
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{row.warrior.name}</span>
            <span class="block truncate text-xs text-base-content/60">{row.note}</span>
          </span>
        </li>
      {/each}
    </ul>
    <p class="text-xs text-base-content/60">{footnote}</p>
  {/if}
</ConfirmDialog>
