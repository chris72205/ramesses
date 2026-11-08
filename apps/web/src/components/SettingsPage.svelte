<script lang="ts">
  import { warriors } from '../lib/warriors.svelte';
  import WarriorsManager from './WarriorsManager.svelte';
</script>

<section class="mx-auto max-w-3xl space-y-4">
  <h1 class="text-xl font-semibold tracking-tight">Settings</h1>

  <div class="card bg-base-100 shadow-sm">
    <div class="card-body gap-4 p-4 sm:p-6">
      <div>
        <h2 class="card-title text-base">Warriors</h2>
        <p class="text-sm text-base-content/60">
          The Archive Team Warrior instances Ramesses connects to. Disable one to stop collecting
          from it without forgetting it.
        </p>
      </div>
      {#if warriors.error}
        <div role="alert" class="alert alert-error text-sm">
          <span>Could not load warriors: {warriors.error}</span>
          <button class="btn btn-sm" onclick={() => void warriors.load()}>Retry</button>
        </div>
      {:else}
        <WarriorsManager records={warriors.records ?? []} onchange={() => void warriors.load()} />
      {/if}
    </div>
  </div>
</section>
