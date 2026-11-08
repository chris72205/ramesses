import '@testing-library/jest-dom/vitest';

// sv-router preloads routes when links scroll into view; jsdom has no IntersectionObserver.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class NoopIntersectionObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
    public takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}

// Svelte's bind:clientWidth uses ResizeObserver, which jsdom lacks; sizes stay at their fallbacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  }
  globalThis.ResizeObserver = NoopResizeObserver;
}
