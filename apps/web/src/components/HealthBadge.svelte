<script lang="ts">
  import type { QueueHealth } from '@ramesses/shared';

  let { health }: { health: QueueHealth } = $props();

  const LOOK: Record<QueueHealth, { label: string; classes: string; title: string }> = {
    backlog: {
      label: 'Backlog',
      classes: 'badge-info badge-soft',
      title: 'Work available in nearly every sample over the last day, and the queue is deep',
    },
    healthy: {
      label: 'Healthy',
      classes: 'badge-success badge-soft',
      title: 'Work available in nearly every sample over the last day',
    },
    intermittent: {
      label: 'Intermittent',
      classes: 'badge-warning badge-soft',
      title: 'Work appears in bursts: the queue is refilled in batches',
    },
    drained: {
      label: 'Drained',
      classes: 'badge-error badge-soft',
      title: 'Hardly any work waiting across the last day of samples',
    },
    unknown: {
      label: 'Unknown',
      classes: 'badge-ghost',
      title: 'Too few samples to judge yet',
    },
  };
  const look = $derived(LOOK[health]);
</script>

<span class="badge badge-sm whitespace-nowrap {look.classes}" title={look.title}>{look.label}</span>
