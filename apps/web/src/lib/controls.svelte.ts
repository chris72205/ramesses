import type { WarriorControlCommand, WarriorSnapshot } from '@ramesses/shared';
import { api } from './api';

/** A control request the warrior has accepted but whose effect the snapshot does not show yet. */
export interface PendingControl {
  command: Extract<WarriorControlCommand, 'select_project' | 'deselect_project'>;
  /** catalog key of the project being selected */
  name: string | null;
  /** what the card says while waiting, such as "Switching to Blogger…" */
  label: string;
  since: number;
  /** a status other than "running" was seen since the request, so a later "running" is the new project */
  transitioned: boolean;
}

/** A pending control is forgotten after this long even if the snapshot never confirmed it. */
export const PENDING_TIMEOUT_MS = 30_000;

/**
 * Per-warrior state of the control requests made from this browser: what is pending and the
 * last error. The warrior only acknowledges a request; its effect arrives later as events, so
 * cards call `settle` whenever their snapshot changes to clear a pending entry once the
 * snapshot shows the outcome.
 */
export class ControlsStore {
  pending = $state<Record<string, PendingControl>>({});
  errors = $state<Record<string, string>>({});
  /** expiry timer per warrior id; plain bookkeeping, nothing renders from it */
  private readonly timers: Record<string, ReturnType<typeof setTimeout>> = {};

  /** Ask the warrior to work on `name`. Resolves to true when the warrior accepted. */
  public async selectProject(warrior: WarriorSnapshot, name: string): Promise<boolean> {
    const title = warrior.catalog[name]?.title ?? name;
    return this.run(warrior, {
      command: 'select_project',
      name,
      label: `Switching to ${title}…`,
      since: Date.now(),
      transitioned: warrior.status !== 'RUNNING_PROJECT',
    });
  }

  /** Ask the warrior to finish its items and then idle. Resolves to true when it accepted. */
  public async deselectProject(warrior: WarriorSnapshot): Promise<boolean> {
    return this.run(warrior, {
      command: 'deselect_project',
      name: null,
      label: 'Stopping work…',
      since: Date.now(),
      transitioned: false,
    });
  }

  /** Clear the pending entry for `warrior` once its snapshot shows the requested outcome. */
  public settle(warrior: WarriorSnapshot): void {
    const pending = this.pending[warrior.id];
    if (!pending) return;
    if (pending.command === 'deselect_project') {
      if (warrior.status === 'NO_PROJECT' || warrior.project === null) this.clear(warrior.id);
      return;
    }
    if (warrior.status !== 'RUNNING_PROJECT') {
      if (!pending.transitioned) pending.transitioned = true;
      return;
    }
    if (pending.transitioned && warrior.project?.name === pending.name) this.clear(warrior.id);
  }

  public dismissError(id: string): void {
    delete this.errors[id];
  }

  private async run(warrior: WarriorSnapshot, control: PendingControl): Promise<boolean> {
    const { id } = warrior;
    delete this.errors[id];
    this.pending[id] = control;
    this.resetTimer(id);
    try {
      if (control.command === 'select_project') await api.selectProject(id, control.name!);
      else await api.deselectProject(id);
      return true;
    } catch (error) {
      this.clear(id);
      this.errors[id] = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  private resetTimer(id: string): void {
    const existing = this.timers[id];
    if (existing) clearTimeout(existing);
    this.timers[id] = setTimeout(() => this.clear(id), PENDING_TIMEOUT_MS);
  }

  private clear(id: string): void {
    delete this.pending[id];
    const timer = this.timers[id];
    if (timer) clearTimeout(timer);
    delete this.timers[id];
  }
}

export const controls = new ControlsStore();
