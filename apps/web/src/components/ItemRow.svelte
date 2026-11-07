<script lang="ts">
  import type { ItemSnapshot } from '@ramesses/shared';
  import { formatDuration } from '../lib/format';
  import TaskProgress from './TaskProgress.svelte';

  let { item, now }: { item: ItemSnapshot; now: number } = $props();

  const elapsed = $derived(
    formatDuration(((item.finishedAt ?? now) - item.startTime * 1000) / 1000),
  );
  const statusLook = $derived(
    item.status === 'completed'
      ? 'badge-success'
      : item.status === 'failed'
        ? 'badge-error'
        : item.status === 'canceled'
          ? 'badge-warning'
          : 'badge-ghost',
  );
  const displayName = $derived(
    item.name.replace(/^Item\s+/, '').replaceAll('\u0000', ' · ') || `#${item.number}`,
  );
</script>

<li class="py-2 px-1">
  <details class="group">
    <summary class="list-none cursor-pointer space-y-1">
      <div class="flex items-center gap-2 text-sm">
        <span class="font-mono text-xs text-base-content/50 shrink-0">#{item.number}</span>
        <span class="truncate flex-1" title={displayName}>{displayName}</span>
        <span class="font-mono text-xs tabular-nums text-base-content/60 shrink-0">{elapsed}</span>
        {#if item.status !== 'running'}
          <span class="badge badge-xs {statusLook}">{item.status}</span>
        {/if}
      </div>
      <TaskProgress tasks={item.tasks} />
    </summary>
    {#if item.logTail}
      <pre
        class="mt-2 max-h-48 overflow-auto rounded bg-neutral text-neutral-content p-2 text-[11px] leading-tight whitespace-pre-wrap break-all">{item.logTail}</pre>
    {:else}
      <p class="mt-2 text-xs text-base-content/50">No output yet.</p>
    {/if}
  </details>
</li>
