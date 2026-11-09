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

/** Whether the warrior accepted a control request, with the server's message when it did not. */
export type ControlResult = { accepted: true } | { accepted: false; error: string };

/** A pending control is forgotten after this long even if the snapshot never confirmed it. */
export const PENDING_TIMEOUT_MS = 30_000;

/**
 * Per-warrior state of the control requests made from this browser: what is pending. The
 * warrior only acknowledges a request; its effect arrives later as events, so cards call
 * `settle` whenever their snapshot changes to clear a pending entry once the snapshot shows the
 * outcome. Whether a request was accepted is returned to the caller, which reports it.
 */
export class ControlsStore {
  pending = $state<Record<string, PendingControl>>({});
  /** expiry timer per warrior id; plain bookkeeping, nothing renders from it */
  private readonly timers: Record<string, ReturnType<typeof setTimeout>> = {};

  /** Ask the warrior to work on `name`. */
  public async selectProject(warrior: WarriorSnapshot, name: string): Promise<ControlResult> {
    const title = warrior.catalog[name]?.title ?? name;
    return this.run(warrior, {
      command: 'select_project',
      name,
      label: `Switching to ${title}…`,
      since: Date.now(),
      transitioned: warrior.status !== 'RUNNING_PROJECT',
    });
  }

  /** Ask the warrior to finish its items and then idle. */
  public async deselectProject(warrior: WarriorSnapshot): Promise<ControlResult> {
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

  private async run(warrior: WarriorSnapshot, control: PendingControl): Promise<ControlResult> {
    const { id } = warrior;
    this.pending[id] = control;
    this.resetTimer(id);
    try {
      if (control.command === 'select_project') await api.selectProject(id, control.name!);
      else await api.deselectProject(id);
      return { accepted: true };
    } catch (error) {
      this.clear(id);
      return { accepted: false, error: error instanceof Error ? error.message : String(error) };
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
