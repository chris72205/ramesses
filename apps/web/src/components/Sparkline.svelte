<script lang="ts">
  import { formatClock } from '../lib/format';

  interface Point {
    /** ISO timestamp */
    at: string;
    value: number;
  }

  let {
    points,
    color,
    format,
    label,
  }: {
    points: Point[];
    /** CSS color or custom property for the line */
    color: string;
    format: (value: number) => string;
    /** what the series is, for the accessible name */
    label: string;
  } = $props();

  const W = 120;
  const H = 28;
  const PAD = 2;

  const max = $derived(Math.max(1, ...points.map((p) => p.value)));
  const x = (i: number) =>
    points.length < 2 ? W : PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = $derived(
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' '),
  );

  let hover = $state<number | null>(null);
  function onmove(event: MouseEvent) {
    if (points.length < 2) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    hover = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
  }
  const current = $derived(hover === null ? null : (points[hover] ?? null));
</script>

{#if points.length < 2}
  <span class="text-base-content/40">&mdash;</span>
{:else}
  <div class="relative inline-block align-middle">
    <svg
      viewBox="0 0 {W} {H}"
      preserveAspectRatio="none"
      class="block h-7 w-28"
      role="img"
      aria-label="{label}, peak {format(max)}"
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
        d={path}
        fill="none"
        stroke={color}
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
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
    {#if current}
      <div
        class="pointer-events-none absolute -top-7 right-0 z-10 rounded bg-base-300 px-2 py-0.5 text-[11px] font-mono tabular-nums whitespace-nowrap shadow"
      >
        <span class="text-base-content/60">{formatClock(Date.parse(current.at))}</span>
        {format(current.value)}
      </div>
    {/if}
  </div>
{/if}
