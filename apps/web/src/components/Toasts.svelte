<script lang="ts">
  import { type NotificationLevel, notifications } from '../lib/notifications.svelte';

  /**
   * The one place action outcomes are shown. Bottom-right on wide screens, bottom-center on a
   * phone, newest at the bottom so the stack grows upward. Rendered only while there is
   * something to show: an empty daisyUI toast box still has padding and would catch clicks.
   */
  const LOOK: Record<NotificationLevel, string> = {
    success: 'alert-success',
    info: 'alert-info',
    error: 'alert-error',
  };
</script>

{#if notifications.items.length > 0}
  <!--
    A bottom-aligned column clipped at the viewport height overflows at its top edge, so when
    the stack is taller than the screen the oldest notices are the ones hidden. daisyUI's toast
    animation already respects prefers-reduced-motion.
  -->
  <div
    class="toast toast-bottom toast-center sm:toast-end z-40 max-h-dvh justify-end overflow-hidden"
    role="region"
    aria-label="Notifications"
  >
    {#each notifications.items as item (item.id)}
      <div
        class="alert alert-soft {LOOK[
          item.level
        ]} w-80 max-w-full whitespace-normal wrap-break-word"
        role={item.level === 'error' ? 'alert' : 'status'}
      >
        <span class="min-w-0">{item.message}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square justify-self-end"
          aria-label="Dismiss"
          onclick={() => notifications.dismiss(item.id)}>✕</button
        >
      </div>
    {/each}
  </div>
{/if}
