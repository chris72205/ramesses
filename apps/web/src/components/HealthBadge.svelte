<script lang="ts">
  import type { QueueHealth } from '@ramesses/shared';
  import { HEALTH_LABELS } from '../lib/project-filters';

  let { health }: { health: QueueHealth } = $props();

  const LOOK: Record<QueueHealth, { classes: string; title: string }> = {
    backlog: {
      classes: 'badge-info badge-soft',
      title: 'Work available in nearly every sample over the last day, and the queue is deep',
    },
    healthy: {
      classes: 'badge-success badge-soft',
      title: 'Work available in nearly every sample over the last day',
    },
    intermittent: {
      classes: 'badge-warning badge-soft',
      title: 'Work appears in bursts: the queue is refilled in batches',
    },
    drained: {
      classes: 'badge-error badge-soft',
      title: 'Hardly any work waiting across the last day of samples',
    },
    unknown: {
      classes: 'badge-ghost',
      title: 'Too few samples to judge yet',
    },
  };
  const look = $derived(LOOK[health]);
</script>

<span class="badge badge-sm whitespace-nowrap {look.classes}" title={look.title}
  >{HEALTH_LABELS[health]}</span
>
