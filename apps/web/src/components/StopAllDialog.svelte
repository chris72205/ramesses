<script lang="ts">
  import { WARRIOR_STATUS_TEXT, type WarriorSnapshot } from '@ramesses/shared';
  import { controls } from '../lib/controls.svelte';
  import WarriorBatchDialog, { type BatchRow } from './WarriorBatchDialog.svelte';

  /**
   * Take every working warrior off its project so the fleet goes idle, for example before the
   * containers are changed. Each warrior finishes its items first; nothing is shut down.
   */
  let { warriors, onclose }: { warriors: WarriorSnapshot[]; onclose: () => void } = $props();

  const rows = $derived<BatchRow[]>(
    warriors
      .filter((w) => w.enabled && w.connection.state === 'connected' && w.project !== null)
      .map((warrior) => {
        if (warrior.status === 'STOPPING_PROJECT') {
          return { warrior, eligible: false, note: 'Already stopping' };
        }
        if (warrior.status === 'SHUTTING_DOWN' || warrior.status === 'REBOOTING') {
          return { warrior, eligible: false, note: WARRIOR_STATUS_TEXT[warrior.status] };
        }
        return { warrior, eligible: true, note: `Now on ${warrior.project!.title}` };
      }),
  );
</script>

<WarriorBatchDialog
  title="Stop all warriors"
  verb="Stop"
  {rows}
  defaultChecked
  footnote="Each warrior finishes its items in flight, then sits idle until you choose a project. Nothing is shut down."
  emptyText="No connected warrior is working on a project."
  run={(warrior: WarriorSnapshot) => controls.deselectProject(warrior)}
  {onclose}
/>
