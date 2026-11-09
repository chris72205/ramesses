import { SvelteMap } from 'svelte/reactivity';
import type { ProjectSummary } from '@ramesses/shared';
import { api } from './api';

/**
 * Project catalog with the latest tracker numbers. The `/ws` channel fills it: the full catalog
 * arrives in `hello` and again in a `projects` message after every tracker sample. The REST load
 * is the fallback for a page opened before the socket has delivered anything. The catalog is
 * stored whole, hidden projects included; the Projects page filters it from its URL query.
 */
export class ProjectsStore {
  items = $state<ProjectSummary[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  /** ms since epoch of the last successful load, null before the first */
  loadedAt = $state<number | null>(null);

  readonly byName = $derived(new SvelteMap(this.items.map((p) => [p.name, p])));
  /** most recent sample time across the catalog, for the page header */
  readonly lastSampledAt = $derived.by(() => {
    let latest: string | null = null;
    for (const p of this.items) {
      if (p.lastSampledAt && (!latest || p.lastSampledAt > latest)) latest = p.lastSampledAt;
    }
    return latest;
  });

  public async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.replace(await api.listProjects(true));
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  /** Swap in a full catalog, from the push channel or from the REST fallback. */
  public replace(items: ProjectSummary[]): void {
    this.items = items;
    this.loadedAt = Date.now();
  }
}

export const projects = new ProjectsStore();
