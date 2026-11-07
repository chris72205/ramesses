<script lang="ts">
  import type { FleetTotals } from '@ramesses/shared';
  import { formatBytes, formatRate, formatWindow } from '../lib/format';

  let { totals }: { totals: FleetTotals } = $props();
</script>

<div class="stats stats-vertical sm:stats-horizontal w-full bg-base-100 shadow-sm">
  <div class="stat">
    <div class="stat-title">Warriors</div>
    <div class="stat-value text-2xl">
      {totals.connected}<span class="text-base-content/40 text-lg"> / {totals.enabled}</span>
    </div>
    <div class="stat-desc">
      connected / enabled{totals.warriors !== totals.enabled
        ? `, ${totals.warriors - totals.enabled} disabled`
        : ''}
    </div>
  </div>
  <div class="stat">
    <div class="stat-title">Download</div>
    <div class="stat-value text-2xl" style="color: var(--viz-down)">
      {formatRate(totals.receiving)}
    </div>
    <div class="stat-desc">
      {formatWindow(totals.rollingWindowMs)} avg {formatRate(totals.avgReceiving)} · {formatBytes(
        totals.received,
      )} total
    </div>
  </div>
  <div class="stat">
    <div class="stat-title">Upload</div>
    <div class="stat-value text-2xl" style="color: var(--viz-up)">{formatRate(totals.sending)}</div>
    <div class="stat-desc">
      {formatWindow(totals.rollingWindowMs)} avg {formatRate(totals.avgSending)} · {formatBytes(
        totals.sent,
      )} total
    </div>
  </div>
  <div class="stat">
    <div class="stat-title">Items in flight</div>
    <div class="stat-value text-2xl">{totals.itemsInFlight}</div>
    <div class="stat-desc">
      {totals.completed} completed, {totals.failed} failed since the backend started
    </div>
  </div>
  <div class="stat">
    <div class="stat-title">Projects</div>
    <div class="stat-value text-2xl">{totals.projects.length}</div>
    <div class="stat-desc truncate" title={totals.projects.join(', ')}>
      {totals.projects.length ? totals.projects.join(', ') : 'none running'}
    </div>
  </div>
</div>
