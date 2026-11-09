export type NotificationLevel = 'success' | 'info' | 'error';

export interface Notification {
  id: number;
  level: NotificationLevel;
  message: string;
  createdAt: number;
  /** milliseconds until it dismisses itself; null keeps it until the user dismisses it */
  timeout: number | null;
}

/** The most notifications kept at once; a new one beyond this drops the oldest. */
export const MAX_NOTIFICATIONS = 10;
export const DEFAULT_TIMEOUT_MS = 6_000;

/**
 * Outcomes of actions taken in this browser, shown as toasts by `Toasts.svelte`. Success and
 * info notices dismiss themselves; errors stay until dismissed. The list is oldest first: the
 * host anchors the stack to the bottom edge, so a new notice pushes the older ones up.
 */
export class NotificationsStore {
  items = $state<Notification[]>([]);
  private nextId = 1;
  /** auto-dismiss timer per notice id; plain bookkeeping, nothing renders from it */
  private readonly timers: Record<number, ReturnType<typeof setTimeout>> = {};

  public success(message: string, timeout: number = DEFAULT_TIMEOUT_MS): number {
    return this.push('success', message, timeout);
  }

  public info(message: string, timeout: number = DEFAULT_TIMEOUT_MS): number {
    return this.push('info', message, timeout);
  }

  public error(message: string): number {
    return this.push('error', message, null);
  }

  public dismiss(id: number): void {
    const timer = this.timers[id];
    if (timer) clearTimeout(timer);
    delete this.timers[id];
    this.items = this.items.filter((item) => item.id !== id);
  }

  public clear(): void {
    for (const id of Object.keys(this.timers)) this.dismiss(Number(id));
    this.items = [];
  }

  private push(level: NotificationLevel, message: string, timeout: number | null): number {
    const id = this.nextId++;
    while (this.items.length >= MAX_NOTIFICATIONS) this.dismiss(this.items[0]!.id);
    this.items = [...this.items, { id, level, message, createdAt: Date.now(), timeout }];
    if (timeout !== null) this.timers[id] = setTimeout(() => this.dismiss(id), timeout);
    return id;
  }
}

export const notifications = new NotificationsStore();
