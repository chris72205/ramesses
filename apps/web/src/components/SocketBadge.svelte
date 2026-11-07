<script lang="ts">
  import type { SocketState } from '../lib/fleet.svelte';

  let { state }: { state: SocketState } = $props();

  const look = $derived(
    state === 'open'
      ? { cls: 'badge-success', text: 'Live' }
      : state === 'reconnecting'
        ? { cls: 'badge-warning', text: 'Reconnecting' }
        : { cls: 'badge-ghost', text: 'Connecting' },
  );
</script>

<span class="badge badge-sm gap-1 {look.cls}" title="Connection to the Ramesses backend">
  <span class="inline-block size-1.5 rounded-full bg-current"></span>
  {look.text}
</span>
