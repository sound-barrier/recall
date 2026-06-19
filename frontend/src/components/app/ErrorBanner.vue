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
  <p v-if="error" class="error" data-testid="error-banner">
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
