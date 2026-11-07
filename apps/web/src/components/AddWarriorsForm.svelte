<script lang="ts">
  import type { CreateWarriorInput } from '@ramesses/shared';
  import { api, ApiError, parseHostLine } from '../lib/api';

  let { onadded }: { onadded: () => void } = $props();

  let host = $state('');
  let port = $state('');
  let name = $state('');
  let bulk = $state('');
  let busy = $state(false);
  let errors = $state<string[]>([]);
  let added = $state(0);

  async function submit(inputs: CreateWarriorInput[]): Promise<void> {
    busy = true;
    errors = [];
    added = 0;
    for (const input of inputs) {
      try {
        await api.createWarrior(input);
        added += 1;
      } catch (error) {
        const label = input.port ? `${input.host}:${input.port}` : input.host;
        errors = [
          ...errors,
          `${label}: ${error instanceof ApiError ? error.message : String(error)}`,
        ];
      }
    }
    busy = false;
    if (added > 0) onadded();
  }

  async function addOne(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const input: CreateWarriorInput = { host: host.trim() };
    if (port.trim()) input.port = Number(port);
    if (name.trim()) input.name = name.trim();
    await submit([input]);
    if (errors.length === 0) {
      host = '';
      port = '';
      name = '';
    }
  }

  async function addBulk(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const inputs = bulk
      .split('\n')
      .map(parseHostLine)
      .filter((input): input is CreateWarriorInput => input !== null);
    if (inputs.length === 0) return;
    await submit(inputs);
    if (errors.length === 0) bulk = '';
  }
</script>

<div class="space-y-5">
  <form class="grid gap-3 sm:grid-cols-[1fr_7rem_1fr_auto] sm:items-end" onsubmit={addOne}>
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-base-content/70">Host or IP</span>
      <input class="input input-sm w-full" bind:value={host} placeholder="192.0.2.10" required />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-base-content/70">Port</span>
      <input
        class="input input-sm w-full"
        bind:value={port}
        placeholder="8001"
        inputmode="numeric"
        pattern="[0-9]*"
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-base-content/70">Name (optional)</span>
      <input class="input input-sm w-full" bind:value={name} placeholder="warrior-1" />
    </label>
    <button class="btn btn-sm btn-primary" type="submit" disabled={busy || !host.trim()}>Add</button
    >
  </form>

  <form class="flex flex-col gap-3" onsubmit={addBulk}>
    <label class="flex flex-col gap-1">
      <span class="text-xs font-medium text-base-content/70">
        Or paste several, one <code class="font-mono">host[:port]</code> per line
      </span>
      <textarea
        class="textarea textarea-sm w-full font-mono"
        rows="4"
        bind:value={bulk}
        placeholder="192.0.2.10:8001&#10;192.0.2.10:8002&#10;warrior-3.lan"
      ></textarea>
    </label>
    <div>
      <button class="btn btn-sm" type="submit" disabled={busy || !bulk.trim()}>Add all</button>
    </div>
  </form>

  {#if errors.length}
    <div role="alert" class="alert alert-error text-sm">
      <ul class="list-disc list-inside">
        {#each errors as error (error)}<li>{error}</li>{/each}
      </ul>
    </div>
  {/if}
</div>
