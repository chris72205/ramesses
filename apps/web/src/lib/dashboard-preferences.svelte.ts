export const SHOW_ITEMS_KEY = 'ramesses.dashboard.showItems';

/**
 * How this browser displays the dashboard. Kept in `localStorage` because there is no signed-in
 * user to attach it to; the `storage` event carries a change to the other open tabs. Storage can
 * be unavailable (blocked site data, some private windows), so every access falls back to the
 * default and the preference then lasts only as long as the page.
 */
export class DashboardPreferencesStore {
  showItems = $state(true);

  constructor() {
    this.showItems = this.readShowItems();
    window.addEventListener('storage', (event) => {
      // A null key means the whole storage area was cleared.
      if (event.key === SHOW_ITEMS_KEY || event.key === null) {
        this.showItems = this.readShowItems();
      }
    });
  }

  public setShowItems(value: boolean): void {
    this.showItems = value;
    try {
      localStorage.setItem(SHOW_ITEMS_KEY, String(value));
    } catch {
      // Not persisted; the choice still applies to this page.
    }
  }

  /** Anything but an explicit "false", including a missing or corrupt value, shows the items. */
  private readShowItems(): boolean {
    try {
      return localStorage.getItem(SHOW_ITEMS_KEY) !== 'false';
    } catch {
      return true;
    }
  }
}

export const dashboardPreferences = new DashboardPreferencesStore();
