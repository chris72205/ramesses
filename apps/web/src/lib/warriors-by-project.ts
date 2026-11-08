import type { WarriorSnapshot, WarriorStatus } from '@ramesses/shared';

/** What the projects pages show about one of your warriors working on a project. */
export interface ProjectWarrior {
  id: string;
  name: string;
  status: WarriorStatus | null;
  connected: boolean;
  runningItems: number;
}

/**
 * Group the fleet by the catalog key of the project each warrior is on. A warrior whose project
 * could not be matched to the catalog (no `name`) is left out; a disconnected warrior keeps its
 * last known project so the row does not flicker on a dropped socket.
 */
export function groupWarriorsByProject(warriors: WarriorSnapshot[]): Map<string, ProjectWarrior[]> {
  const groups = new Map<string, ProjectWarrior[]>();
  for (const warrior of warriors) {
    const key = warrior.project?.name;
    if (!key || !warrior.enabled) continue;
    const list = groups.get(key) ?? [];
    list.push({
      id: warrior.id,
      name: warrior.name,
      status: warrior.status,
      connected: warrior.connection.state === 'connected',
      runningItems: warrior.items.filter((item) => item.status === 'running').length,
    });
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  return groups;
}
