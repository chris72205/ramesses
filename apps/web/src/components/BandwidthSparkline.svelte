<script lang="ts">
  import type { BandwidthSample } from '@ramesses/shared';
  import { formatClock, formatRate, formatWindow } from '../lib/format';

  let { history }: { history: BandwidthSample[] } = $props();

  const W = 240;
  const H = 48;
  const PAD = 2;

  const max = $derived(Math.max(1, ...history.map((s) => Math.max(s.receiving, s.sending))));
  const x = (i: number) =>
    history.length < 2 ? W : PAD + (i / (history.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (pick: (s: BandwidthSample) => number) =>
    history
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(s)).toFixed(1)}`)
      .join(' ');

  const down = $derived(path((s) => s.receiving));
  const up = $derived(path((s) => s.sending));

  let hover = $state<number | null>(null);
  function onmove(event: MouseEvent) {
    if (history.length < 2) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    hover = Math.max(0, Math.min(history.length - 1, Math.round(ratio * (history.length - 1))));
  }
  const sample = $derived(hover === null ? null : (history[hover] ?? null));
  const span = $derived(formatWindow(history.length * 1000));
</script>

<div class="relative min-w-0">
  <svg
    viewBox="0 0 {W} {H}"
    preserveAspectRatio="none"
    class="block h-12 w-full"
    role="img"
    aria-label="Bandwidth over the last {span}, peak {formatRate(max)}"
    onmousemove={onmove}
    onmouseleave={() => (hover = null)}
  >
    <line
      x1="0"
      x2={W}
      y1={H - PAD}
      y2={H - PAD}
      stroke="var(--viz-grid)"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
    <path
      d={down}
      fill="none"
      stroke="var(--viz-down)"
      stroke-width="2"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
    <path
      d={up}
      fill="none"
      stroke="var(--viz-up)"
      stroke-width="2"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
    {#if hover !== null}
      <line
        x1={x(hover)}
        x2={x(hover)}
        y1="0"
        y2={H}
        stroke="currentColor"
        stroke-opacity="0.3"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
    {/if}
  </svg>
  {#if sample}
    <div
      class="pointer-events-none absolute -top-1 right-0 rounded bg-base-300 px-2 py-1 text-[11px] font-mono tabular-nums shadow"
    >
      <span class="text-base-content/60">{formatClock(sample.at)}</span>
      <span style="color: var(--viz-down)">↓</span>
      {formatRate(sample.receiving)}
      <span style="color: var(--viz-up)">↑</span>
      {formatRate(sample.sending)}
    </div>
  {:else if history.length > 1}
    <div
      class="pointer-events-none absolute -top-1 right-0 rounded bg-base-100/80 px-1 text-[10px] text-base-content/50"
    >
      last {span}
    </div>
  {/if}
</div>
