import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPreferencesStore, SHOW_ITEMS_KEY } from './dashboard-preferences.svelte';

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}

function fireStorageEvent(key: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

describe('DashboardPreferencesStore', () => {
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows items by default', () => {
    expect(new DashboardPreferencesStore().showItems).toBe(true);
  });

  it('starts from the stored choice', () => {
    stubStorage({ [SHOW_ITEMS_KEY]: 'false' });
    expect(new DashboardPreferencesStore().showItems).toBe(false);
  });

  it('treats a corrupt stored value as the default', () => {
    stubStorage({ [SHOW_ITEMS_KEY]: 'nonsense' });
    expect(new DashboardPreferencesStore().showItems).toBe(true);
  });

  it('persists a change', () => {
    const values = stubStorage();
    const store = new DashboardPreferencesStore();
    store.setShowItems(false);
    expect(store.showItems).toBe(false);
    expect(values.get(SHOW_ITEMS_KEY)).toBe('false');
    expect(new DashboardPreferencesStore().showItems).toBe(false);
  });

  it('follows a change made in another tab', () => {
    const values = stubStorage();
    const store = new DashboardPreferencesStore();
    values.set(SHOW_ITEMS_KEY, 'false');
    fireStorageEvent(SHOW_ITEMS_KEY);
    expect(store.showItems).toBe(false);
    values.set(SHOW_ITEMS_KEY, 'true');
    fireStorageEvent(SHOW_ITEMS_KEY);
    expect(store.showItems).toBe(true);
  });

  it('ignores changes to other keys', () => {
    const values = stubStorage();
    const store = new DashboardPreferencesStore();
    values.set(SHOW_ITEMS_KEY, 'false');
    fireStorageEvent('something-else');
    expect(store.showItems).toBe(true);
  });

  it('returns to the default when another tab clears the storage', () => {
    const values = stubStorage({ [SHOW_ITEMS_KEY]: 'false' });
    const store = new DashboardPreferencesStore();
    values.clear();
    fireStorageEvent(null);
    expect(store.showItems).toBe(true);
  });

  it('falls back to the default when storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(new DashboardPreferencesStore().showItems).toBe(true);
  });

  it('still applies a change when storage cannot be written', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    });
    const store = new DashboardPreferencesStore();
    store.setShowItems(false);
    expect(store.showItems).toBe(false);
  });
});
