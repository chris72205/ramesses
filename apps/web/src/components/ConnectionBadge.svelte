<script lang="ts">
  import { QUIET_AFTER_MS, type ConnectionInfo } from '@ramesses/shared';
  import { formatAgo, formatDuration } from '../lib/format';

  let { connection, enabled, now }: { connection: ConnectionInfo; enabled: boolean; now: number } =
    $props();

  // The socket is open but the warrior has sent nothing for a while: its IO loop is busy with a
  // blocking task (the YouTube pipeline sleeps 20 to 30 s per cookie fetch), not dead.
  const quietFor = $derived(
    connection.state === 'connected' && connection.lastSeenAt !== null
      ? now - connection.lastSeenAt
      : 0,
  );
  const quiet = $derived(quietFor >= QUIET_AFTER_MS);

  const look = $derived.by(() => {
    if (!enabled) return { cls: 'badge-ghost', text: 'Disabled' };
    switch (connection.state) {
      case 'connected':
        return quiet
          ? { cls: 'badge-warning badge-soft', text: `Quiet ${formatDuration(quietFor / 1000)}` }
          : { cls: 'badge-success', text: 'Connected' };
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
      quiet
        ? 'The warrior is probably in a task that blocks its process; Ramesses reconnects after a minute of silence.'
        : null,
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
