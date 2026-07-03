<script setup lang="ts">
// Transient error strip under the masthead — Retry (when the failed action is
// replayable) + Dismiss. Reads the message + retry callback from the app store;
// self-gates on a non-empty error.
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const { error, errorRetry } = storeToRefs(appStore)
const { clearError } = appStore
</script>

<template>
  <p v-if="error" class="error error-float" role="alert" data-testid="error-banner">
    <span class="error-tick">✕</span>
    <span class="error-msg">{{ error }}</span>
    <button
      v-if="errorRetry"
      type="button"
      class="error-retry"
      data-testid="error-retry"
      @click="errorRetry?.()"
    >
      Retry
    </button>
    <button
      type="button"
      class="error-dismiss"
      aria-label="Dismiss error"
      data-testid="error-dismiss"
      @click="clearError"
    >
      ✕
    </button>
  </p>
</template>

<style scoped>
/* The banner is the app's failure announcement — it renders OUTSIDE the
   inert-able .container (see App.vue) and above every modal layer
   (detail-panel / narrow backdrops: 90-100; About / cheatsheet: 1000)
   so a mid-modal failure stays visible, announced, and dismissible. */
.error-float {
  position: fixed;
  top: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 2rem));
  margin-top: 0;
  z-index: 1100;

  /* .error's --loss-soft tint is translucent; back it with a solid
     surface so modal backdrops can't bleed through the strip. */
  background:
    linear-gradient(var(--loss-soft), var(--loss-soft)),
    var(--surface);
  box-shadow: 0 6px 24px rgb(0 0 0 / 35%);
}
</style>
