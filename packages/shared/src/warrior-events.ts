/**
 * Events pushed by an Archive Team Warrior over its SockJS endpoint.
 * Shapes were captured from live warriors and the warrior's own script.js.
 */

export type WarriorStatus =
  | 'UNINITIALIZED'
  | 'NO_PROJECT'
  | 'INVALID_SETTINGS'
  | 'STOPPING_PROJECT'
  | 'RESTARTING_PROJECT'
  | 'RUNNING_PROJECT'
  | 'SWITCHING_PROJECT'
  | 'STARTING_PROJECT'
  | 'SHUTTING_DOWN'
  | 'REBOOTING';

export type RunnerStatus = 'running' | 'stopping';

export type TaskStatus = 'running' | 'completed' | 'failed' | null;

export type ItemStatus = 'running' | 'completed' | 'failed' | 'canceled';

export interface WarriorTask {
  id: number;
  name: string;
  status: TaskStatus;
}

export interface WarriorItem {
  id: string;
  name: string;
  number: number;
  status: ItemStatus;
  tasks: WarriorTask[];
  output: string;
  project: string;
  start_time: number;
}

export interface WarriorProject {
  project_id: number;
  title: string;
  project_html: string;
  utc_deadline: string | null;
}

export interface WarriorCatalogProject {
  name: string;
  title: string;
  description: string;
  logo: string;
  leaderboard: string;
  repository: string;
  docker?: string;
  use_docker?: boolean;
  lat_lng?: [number, number];
  marker_html?: string;
}

export interface WarriorEventMap {
  instance_id: string;
  'project.refresh': {
    project: WarriorProject | null;
    status: RunnerStatus;
    items: WarriorItem[];
  } | null;
  'warrior.projects_loaded': { projects: Record<string, WarriorCatalogProject> };
  'warrior.status': { status: WarriorStatus };
  'warrior.broadcast_message': { message: string | null; hash: string };
  'warrior.settings_update': unknown;
  /** the catalog key as a plain string; null when the warrior was given no or an unknown name */
  'warrior.project_selected': { project: string | null };
  'warrior.project_installing': { project: { name: string } };
  'warrior.project_installed': { project: { name: string } };
  'warrior.project_installation_failed': { project: { name: string }; output?: string };
  'runner.status': { status: RunnerStatus };
  'pipeline.start_item': { pipeline_id: number; item: WarriorItem };
  'item.output': { item_id: string; data: string };
  'item.task_status': {
    item_id: string;
    task_id: number;
    new_status: TaskStatus;
    old_status: TaskStatus;
  };
  'item.update_name': { item_id: string; new_name: string };
  'item.complete': { pipeline_id: number; item_id: string };
  'item.fail': { pipeline_id: number; item_id: string };
  'item.cancel': { pipeline_id: number; item_id: string };
  bandwidth: { received: number; sent: number; receiving: number; sending: number };
  timestamp: { timestamp: number };
}

export type WarriorEventName = keyof WarriorEventMap;

export type WarriorEvent = {
  [K in WarriorEventName]: { event_name: K; message: WarriorEventMap[K] };
}[WarriorEventName];

/** Human text for each warrior status, mirroring the stock UI. */
export const WARRIOR_STATUS_TEXT: Record<WarriorStatus, string> = {
  UNINITIALIZED: 'Could not contact HQ',
  NO_PROJECT: 'Idle, no project selected',
  INVALID_SETTINGS: 'Needs configuration',
  STOPPING_PROJECT: 'Stopping project',
  RESTARTING_PROJECT: 'Restarting project',
  RUNNING_PROJECT: 'Working on a project',
  SWITCHING_PROJECT: 'Switching project',
  STARTING_PROJECT: 'Starting project',
  SHUTTING_DOWN: 'Shutting down',
  REBOOTING: 'Rebooting',
};
