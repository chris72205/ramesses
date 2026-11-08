import type { WarriorRecord } from '@ramesses/shared';
import { api } from './api';

/** The configured warrior list, shared by the app shell (first-run setup) and the Settings page. */
export class WarriorsStore {
  /** null until the first load has answered */
  records = $state<WarriorRecord[] | null>(null);
  error = $state<string | null>(null);

  public async load(): Promise<void> {
    try {
      this.records = await api.listWarriors();
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
}

export const warriors = new WarriorsStore();
