<script lang="ts">
  import { formatClock, formatDateTime } from '../lib/format';

  interface Point {
    /** ms since epoch */
    at: number;
    /** null breaks the line (no rate for the first sample, or a counter reset) */
    value: number | null;
  }

  let {
    title,
    points,
    color,
    format,
  }: {
    title: string;
    points: Point[];
    color: string;
    format: (value: number) => string;
  } = $props();

  const H = 220;
  const PAD = { top: 10, right: 16, bottom: 26, left: 56 };
  let width = $state(0);
  const w = $derived(width || 600);
  const plotW = $derived(w - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;

  const valued = $derived(
    points.filter((p): p is { at: number; value: number } => p.value !== null),
  );
  const minAt = $derived(points.length ? points[0]!.at : 0);
  const maxAt = $derived(points.length ? points[points.length - 1]!.at : 1);
  const maxValue = $derived(Math.max(0, ...valued.map((p) => p.value)));
  /** A clean tick step (1, 2, 2.5, or 5 times a power of ten) aiming at about four intervals. */
  const tickStep = $derived.by(() => {
    if (maxValue <= 0) return 0.25;
    const raw = maxValue / 4;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    return ([1, 2, 2.5, 5, 10].find((s) => s * magnitude >= raw) ?? 10) * magnitude;
  });
  const niceMax = $derived(Math.max(tickStep, Math.ceil(maxValue / tickStep) * tickStep));
  const ticks = $derived(
    Array.from({ length: Math.round(niceMax / tickStep) + 1 }, (_, i) => i * tickStep),
  );

  const x = (at: number) =>
    PAD.left + (maxAt === minAt ? plotW / 2 : ((at - minAt) / (maxAt - minAt)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;

  /** One path per run of non-null points. */
  const segments = $derived.by(() => {
    const runs: Array<Array<{ at: number; value: number }>> = [];
    let run: Array<{ at: number; value: number }> = [];
    for (const p of points) {
      if (p.value === null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push({ at: p.at, value: p.value });
    }
    if (run.length) runs.push(run);
    return runs;
  });
  const linePath = (run: Array<{ at: number; value: number }>) =>
    run
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');
  const areaPath = (run: Array<{ at: number; value: number }>) =>
    run.length < 2
      ? ''
      : `${linePath(run)} L${x(run[run.length - 1]!.at).toFixed(1)},${y(0).toFixed(1)} L${x(run[0]!.at).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = $derived(valued.length ? valued[valued.length - 1]! : null);

  const spanMs = $derived(maxAt - minAt);
  const xTicks = $derived.by(() => {
    if (points.length < 2) return [] as number[];
    const count = w < 480 ? 3 : 5;
    return Array.from({ length: count }, (_, i) => minAt + (spanMs * i) / (count - 1));
  });
  const xLabel = (at: number) =>
    spanMs > 2 * 86_400_000
      ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : formatClock(at);

  let hover = $state<number | null>(null);
  function onmove(event: PointerEvent) {
    if (points.length === 0) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * w;
    const at = minAt + ((px - PAD.left) / Math.max(1, plotW)) * (maxAt - minAt);
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i]!.at - at) < Math.abs(points[best]!.at - at)) best = i;
    }
    hover = best;
  }
  const current = $derived(hover === null ? null : (points[hover] ?? null));
  let tableOpen = $state(false);
</script>

<!-- A plain block: daisyUI lays out <figure> inside a card as a centered row. -->
<div class="min-w-0">
  <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
    <span class="font-medium">{title}</span>
    {#if last}
      <span class="font-mono tabular-nums text-base-content/70">now {format(last.value)}</span>
    {/if}
  </div>
  {#if valued.length === 0}
    <div
      class="flex h-[220px] items-center justify-center rounded bg-base-200/50 text-sm text-base-content/50"
    >
      No samples in this range yet
    </div>
  {:else}
    <div class="relative" bind:clientWidth={width}>
      <svg
        viewBox="0 0 {w} {H}"
        class="block w-full"
        style="height: {H}px"
        role="img"
        aria-label="{title}: {valued.length} samples, latest {format(last!.value)}"
        onpointermove={onmove}
        onpointerleave={() => (hover = null)}
      >
        {#each ticks as tick (tick)}
          <line
            x1={PAD.left}
            x2={w - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--viz-grid)"
            stroke-width="1"
          />
          <text
            x={PAD.left - 8}
            y={y(tick)}
            text-anchor="end"
            dominant-baseline="middle"
            class="fill-current text-[10px] opacity-60"
          >
            {format(tick)}
          </text>
        {/each}
        {#each xTicks as tick, i (i)}
          <text
            x={x(tick)}
            y={H - 8}
            text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            class="fill-current text-[10px] opacity-60"
          >
            {xLabel(tick)}
          </text>
        {/each}
        {#each segments as run, i (i)}
          {#if run.length > 1}
            <path d={areaPath(run)} fill={color} fill-opacity="0.1" />
          {/if}
          <path
            d={linePath(run)}
            fill="none"
            stroke={color}
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        {/each}
        {#if last}
          <circle
            cx={x(last.at)}
            cy={y(last.value)}
            r="4"
            fill={color}
            stroke="var(--color-base-100)"
            stroke-width="2"
          />
        {/if}
        {#if current}
          <line
            x1={x(current.at)}
            x2={x(current.at)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="currentColor"
            stroke-opacity="0.3"
            stroke-width="1"
          />
          {#if current.value !== null}
            <circle
              cx={x(current.at)}
              cy={y(current.value)}
              r="4"
              fill={color}
              stroke="var(--color-base-100)"
              stroke-width="2"
            />
          {/if}
        {/if}
      </svg>
      {#if current}
        <div
          class="pointer-events-none absolute top-1 rounded bg-base-300 px-2 py-1 text-[11px] font-mono tabular-nums whitespace-nowrap shadow"
          style={x(current.at) > w / 2 ? 'left: 0.5rem' : 'right: 0.5rem'}
        >
          <strong>{current.value === null ? 'no rate' : format(current.value)}</strong>
          <span class="text-base-content/60"
            >{formatDateTime(new Date(current.at).toISOString())}</span
          >
        </div>
      {/if}
    </div>
    <details class="mt-1 text-xs" bind:open={tableOpen}>
      <summary class="cursor-pointer text-base-content/60">Show as table</summary>
      {#if tableOpen}
        <div class="max-h-48 overflow-auto">
          <table class="table table-xs">
            <thead><tr><th>Time</th><th class="text-right">{title}</th></tr></thead>
            <tbody>
              {#each points as point (point.at)}
                <tr>
                  <td>{formatDateTime(new Date(point.at).toISOString())}</td>
                  <td class="text-right font-mono tabular-nums">
                    {point.value === null ? '—' : format(point.value)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </details>
  {/if}
</div>
