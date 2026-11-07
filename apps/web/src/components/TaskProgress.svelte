<script lang="ts">
  import type { TaskSnapshot } from '@ramesses/shared';

  let { tasks }: { tasks: TaskSnapshot[] } = $props();

  const done = $derived(tasks.filter((t) => t.status === 'completed').length);
  const failed = $derived(tasks.some((t) => t.status === 'failed'));
  const current = $derived(tasks.find((t) => t.status === 'running')?.name ?? null);
  const percent = $derived(tasks.length ? Math.round((done / tasks.length) * 100) : 0);
</script>

<div
  class="flex items-center gap-2 text-xs"
  title={tasks.map((t) => `${t.name}: ${t.status ?? 'pending'}`).join('\n')}
>
  <progress
    class="progress h-1.5 flex-1 {failed ? 'progress-error' : 'progress-primary'}"
    value={done}
    max={tasks.length || 1}
    aria-label="Tasks completed"
  ></progress>
  <span class="font-mono tabular-nums text-base-content/60 shrink-0">{done}/{tasks.length}</span>
  <span class="truncate text-base-content/70 max-w-40"
    >{current ?? (percent === 100 ? 'done' : '')}</span
  >
</div>
