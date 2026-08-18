<script setup lang="ts">
// Transient receipt strip under the masthead — the counterpart to
// ErrorBanner, for an action that produced something OUTSIDE the app and
// should say where it went.
//
// Deliberately narrow: this is not a confirmation channel for ordinary
// changes, which the UI shows by having changed. It is for a file the user
// can go and open. role="status" rather than "alert" — a receipt is news,
// not a problem, and should not interrupt.
import { onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useAppStore } from '@/stores/app'

const DISMISS_MS = 8000

const appStore = useAppStore()
const { notice } = storeToRefs(appStore)
const { clearNotice } = appStore

// Auto-dismissing, because nothing is wrong and nothing is owed: a receipt
// that has to be closed is a chore for good news. The timer restarts on each
// new receipt so back-to-back exports each get their full window.
let timer: ReturnType<typeof setTimeout> | null = null

function stopTimer() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

watch(notice, (message) => {
  stopTimer()
  if (message) timer = setTimeout(clearNotice, DISMISS_MS)
})

onBeforeUnmount(stopTimer)
</script>

<template>
  <p v-if="notice" class="notice notice-float" role="status" aria-label="Receipt">
    <span class="notice-tick" aria-hidden="true">✓</span>
    <span class="notice-msg">{{ notice }}</span>
    <button
      type="button"
      class="notice-dismiss"
      aria-label="Dismiss"
      @click="clearNotice"
    >
      ✕
    </button>
  </p>
</template>

<style scoped>
/* Mirrors ErrorBanner's float so the two never fight for the same strip:
   this one sits below it, and both render outside the inert-able container. */
.notice-float {
  position: fixed;
  top: 4.2rem;
  left: 50%;
  z-index: 1600;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  max-width: min(38rem, 92vw);
  margin: 0;
  padding: 0.55rem 0.8rem;
  font-size: var(--type-md);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--win);
  border-radius: var(--radius-md);
  transform: translateX(-50%);
}

.notice-tick {
  flex: none;
  color: var(--win);
  font-weight: 700;
}

.notice-msg {
  flex: 1 1 auto;
  overflow-wrap: anywhere;
}

.notice-dismiss {
  flex: none;
  padding: 0 0.2rem;
  color: var(--text-dim);
  font-size: var(--type-sm);
  background: none;
  border: 0;
  cursor: pointer;
}

.notice-dismiss:hover {
  color: var(--text);
}
</style>
