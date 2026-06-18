<script setup lang="ts">
// Transient error strip under the masthead — Retry (when the failed action
// is replayable) + Dismiss. App owns the message + the retry callback.
defineProps<{ message: string; canRetry: boolean }>()
const emit = defineEmits<{ retry: []; dismiss: [] }>()
</script>

<template>
  <p class="error" data-testid="error-banner">
    <span class="error-tick">✕</span>
    <span class="error-msg">{{ message }}</span>
    <button
      v-if="canRetry"
      type="button"
      class="error-retry"
      data-testid="error-retry"
      @click="emit('retry')"
    >
      Retry
    </button>
    <button
      type="button"
      class="error-dismiss"
      aria-label="Dismiss error"
      data-testid="error-dismiss"
      @click="emit('dismiss')"
    >
      ✕
    </button>
  </p>
</template>
