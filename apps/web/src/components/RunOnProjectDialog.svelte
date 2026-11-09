<script lang="ts">
  import type { WarriorSnapshot } from '@ramesses/shared';
  import { controls } from '../lib/controls.svelte';
  import WarriorBatchDialog, { type BatchRow } from './WarriorBatchDialog.svelte';

  /** Pick connected warriors to move onto one project. */
  let {
    project,
    warriors,
    onclose,
  }: {
    project: { name: string; title: string };
    warriors: WarriorSnapshot[];
    onclose: () => void;
  } = $props();

  const rows = $derived<BatchRow[]>(
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
</script>

<WarriorBatchDialog
  title="Run {project.title} on…"
  verb="Run on"
  subject={project.title}
  {rows}
  footnote="Items in flight finish on the current project before the switch."
  emptyText="No warrior is connected right now."
  run={(warrior: WarriorSnapshot) => controls.selectProject(warrior, project.name)}
  {onclose}
/>
