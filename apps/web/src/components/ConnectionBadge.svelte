<script lang="ts">
  import type { ConnectionInfo } from '@ramesses/shared';
  import { formatAgo } from '../lib/format';

  let { connection, enabled, now }: { connection: ConnectionInfo; enabled: boolean; now: number } =
    $props();

  const look = $derived.by(() => {
    if (!enabled) return { cls: 'badge-ghost', text: 'Disabled' };
    switch (connection.state) {
      case 'connected':
        return { cls: 'badge-success', text: 'Connected' };
      case 'reconnecting':
        return { cls: 'badge-warning', text: `Reconnecting (${connection.attempts})` };
      case 'connecting':
        return { cls: 'badge-info', text: 'Connecting' };
      default:
        return { cls: 'badge-ghost', text: 'Offline' };
    }
  });

  const title = $derived(
    [
      `Last message ${formatAgo(connection.lastSeenAt, now)}`,
      connection.lastError ? `Last error: ${connection.lastError}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
</script>

<span class="badge badge-sm gap-1 {look.cls}" {title}>
  <span class="inline-block size-1.5 rounded-full bg-current"></span>
  {look.text}
</span>
