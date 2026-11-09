<script lang="ts">
  import type { WarriorCatalogProject } from '@ramesses/shared';
  import { fleet } from '../lib/fleet.svelte';
  import { formatCount, formatPerHour } from '../lib/format';
  import { pickerRate, type PickerSort, sortPickerEntries } from '../lib/project-picker';
  import { projects } from '../lib/projects.svelte';
  import { groupWarriorsByProject } from '../lib/warriors-by-project';
  import HealthBadge from './HealthBadge.svelte';

  /**
   * The warrior's own project list with a filter box and one radio per project, each with the
   * tracker numbers the browser already holds. The tracker's "auto" entry is left out: a fleet is
   * run on purpose, never on the tracker's pick.
   */
  let {
    catalog,
    current = null,
    selected = $bindable(null),
  }: {
    catalog: Record<string, WarriorCatalogProject>;
    /** catalog key of the project the warrior is on now */
    current?: string | null;
    selected?: string | null;
  } = $props();

  const SORTS: Array<{ value: PickerSort; label: string }> = [
    { value: 'name', label: 'Name' },
    { value: 'rate', label: 'Rate' },
  ];

  let query = $state('');
  let sort = $state<PickerSort>('name');
  /** catalog key of the row showing its whole description */
  let expanded = $state<string | null>(null);

  const entries = $derived(
    sortPickerEntries(
      Object.entries(catalog)
        .filter(([name]) => name !== 'auto')
        .map(([name, project]) => ({ ...project, name })),
      sort,
      projects.byName,
    ),
  );
  const warriorsByProject = $derived(groupWarriorsByProject(fleet.list));
  const shown = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (p) => p.title.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle),
    );
  });
</script>

{#if entries.length === 0}
  <p class="text-base-content/60">This warrior has not loaded its project list yet.</p>
{:else}
  <div class="flex items-center gap-2">
    <input
      type="search"
      class="input input-sm min-w-0 flex-1"
      placeholder="Filter projects"
      aria-label="Filter projects"
      bind:value={query}
    />
    <div role="group" aria-label="Sort projects" class="flex shrink-0 items-center gap-1">
      {#each SORTS as option (option.value)}
        <button
          type="button"
          class="btn btn-xs {sort === option.value ? 'btn-primary' : 'btn-ghost border-base-300'}"
          aria-pressed={sort === option.value}
          onclick={() => (sort = option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
  <ul
    class="max-h-80 divide-y divide-base-200 overflow-y-auto rounded-box border border-base-300"
    role="radiogroup"
    aria-label="Projects"
  >
    {#each shown as project (project.name)}
      {@const summary = projects.byName.get(project.name)}
      {@const rate = summary ? pickerRate(summary) : null}
      {@const mine = warriorsByProject.get(project.name)?.length ?? 0}
      {@const isExpanded = expanded === project.name}
      <li class="flex items-start hover:bg-base-200">
        <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2">
          <input
            type="radio"
            class="radio radio-sm"
            name="project"
            value={project.name}
            bind:group={selected}
          />
          {#if project.logo}
            <img src={project.logo} alt="" class="size-6 shrink-0 rounded object-contain" />
          {/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{project.title}</span>
            {#if project.description}
              <span
                class="block text-xs text-base-content/60 {isExpanded
                  ? 'wrap-break-word'
                  : 'truncate'}"
                title={project.description}>{project.description}</span
              >
            {/if}
            {#if summary}
              <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {#if summary.tracker !== 'universal'}
                  <span class="text-base-content/50">Stats unavailable</span>
                {:else}
                  <span class="font-mono font-medium tabular-nums" title="Items completed per hour">
                    {formatPerHour(rate?.value)}{rate?.window === '24 h' ? ' (24 h)' : ''}
                  </span>
                  <HealthBadge health={summary.health} />
                  <span class="text-base-content/60">
                    <span class="font-mono tabular-nums">{formatCount(summary.latest?.todo)}</span> to
                    do
                  </span>
                {/if}
              </span>
            {/if}
            {#if mine > 0}
              <span class="mt-1 block text-xs text-base-content/60">
                {mine} of your warriors
              </span>
            {/if}
          </span>
          {#if project.name === current}
            <span class="badge badge-xs badge-ghost">current</span>
          {/if}
        </label>
        {#if project.description}
          <!-- Outside the label, so a tap never selects the project. A title needs a hover. -->
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square mt-2 mr-2 hidden max-sm:inline-flex pointer-coarse:inline-flex"
            aria-expanded={isExpanded}
            aria-label="{isExpanded ? 'Hide' : 'Show'} full description of {project.title}"
            onclick={() => (expanded = isExpanded ? null : project.name)}
          >
            <svg
              class="h-3 w-3 transition-transform {isExpanded ? 'rotate-180' : ''}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        {/if}
      </li>
    {:else}
      <li class="px-3 py-2 text-base-content/60">No project matches.</li>
    {/each}
  </ul>
{/if}
