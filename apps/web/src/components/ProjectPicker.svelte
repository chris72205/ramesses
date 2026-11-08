<script lang="ts">
  import type { WarriorCatalogProject } from '@ramesses/shared';

  /**
   * The warrior's own project list with a filter box and one radio per project. The tracker's
   * "auto" entry is left out: a fleet is run on purpose, never on the tracker's pick.
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

  let query = $state('');

  const entries = $derived(
    Object.entries(catalog)
      .filter(([name]) => name !== 'auto')
      .map(([name, project]) => ({ ...project, name }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );
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
  <input
    type="search"
    class="input input-sm w-full"
    placeholder="Filter projects"
    aria-label="Filter projects"
    bind:value={query}
  />
  <ul
    class="max-h-64 divide-y divide-base-200 overflow-y-auto rounded-box border border-base-300"
    role="radiogroup"
    aria-label="Projects"
  >
    {#each shown as project (project.name)}
      <li>
        <label class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-base-200">
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
              <span class="block truncate text-xs text-base-content/60">{project.description}</span>
            {/if}
          </span>
          {#if project.name === current}
            <span class="badge badge-xs badge-ghost">current</span>
          {/if}
        </label>
      </li>
    {:else}
      <li class="px-3 py-2 text-base-content/60">No project matches.</li>
    {/each}
  </ul>
{/if}
