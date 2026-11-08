<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A modal that asks before a control request goes out. Render it only while it is needed:
   * mounting opens it, unmounting closes it, so one dialog exists on the page at a time.
   */
  let {
    title,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    busy = false,
    disabled = false,
    onconfirm,
    oncancel,
    children,
  }: {
    title: string;
    confirmLabel?: string;
    /** null hides the cancel button, for a dialog that only reports results */
    cancelLabel?: string | null;
    /** a request is in flight: both buttons wait */
    busy?: boolean;
    /** nothing to confirm yet, such as no project picked */
    disabled?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    children: Snippet;
  } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    // jsdom has no showModal; the open attribute keeps the dialog in the document for tests.
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  });

  function cancel(event: Event): void {
    // Escape would close the native dialog; the parent unmounts it instead.
    event.preventDefault();
    if (!busy) oncancel();
  }
</script>

<dialog class="modal" bind:this={dialog} oncancel={cancel} aria-labelledby="confirm-dialog-title">
  <div class="modal-box max-w-md">
    <h3 id="confirm-dialog-title" class="text-base font-semibold">{title}</h3>
    <div class="space-y-3 py-3 text-sm">
      {@render children()}
    </div>
    <div class="modal-action mt-2">
      {#if cancelLabel !== null}
        <button type="button" class="btn btn-ghost btn-sm" onclick={oncancel} disabled={busy}>
          {cancelLabel}
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={onconfirm}
        disabled={busy || disabled}
      >
        {#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
        {confirmLabel}
      </button>
    </div>
  </div>
</dialog>
