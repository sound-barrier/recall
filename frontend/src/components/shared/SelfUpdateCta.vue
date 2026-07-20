<script setup lang="ts">
// In-app self-update CTA — progress bar / Install / Restart / error. A private
// partial of AboutModal's "Recall app" section (parallel to UpdateDiffManifest):
// the parent gates rendering on `info.available && canSelfUpdate` and supplies
// the shared `update-check-modal-btn*` chrome via `:deep()`. The self-update
// state machine lives in the app store — this component only renders the
// `SelfUpdateState` bundle and re-emits install / restart.

import { computed } from 'vue'
import type { SelfUpdateState } from '@/self-update-events'

const props = defineProps<{ state: SelfUpdateState }>()

const emit = defineEmits<{
  install: []
  restart: []
}>()

// Phase groupings for the CTA template.
const busy = computed(() =>
  ['starting', 'downloading', 'verifying', 'installing', 'restarting'].includes(props.state.phase))
const progressLabel = computed(() => {
  const s = props.state
  switch (s.phase) {
    case 'downloading': return s.pct != null ? `Downloading… ${s.pct}%` : 'Downloading…'
    case 'verifying':   return 'Verifying…'
    case 'installing':  return 'Installing…'
    case 'restarting':  return 'Restarting…'
    default:            return 'Starting…'
  }
})
</script>

<template>
  <div
    v-if="busy"
    class="update-check-modal-selfupdate-progress"
    data-self-update-progress
    role="progressbar"
    :aria-valuenow="state.pct ?? undefined"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="progressLabel"
  >
    <span class="update-check-modal-selfupdate-bar">
      <span
        class="update-check-modal-selfupdate-fill"
        :class="{ indeterminate: state.pct == null }"
        :style="state.pct != null ? { width: state.pct + '%' } : undefined"
      />
    </span>
    <span class="update-check-modal-selfupdate-label">{{ progressLabel }}</span>
  </div>

  <button
    v-else-if="state.phase === 'ready'"
    type="button"
    class="update-check-modal-btn update-check-modal-btn-primary"
    data-self-update-restart
    @click="emit('restart')"
  >
    Restart now to apply
  </button>

  <button
    v-else
    type="button"
    class="update-check-modal-btn update-check-modal-btn-primary"
    data-self-update-install
    @click="emit('install')"
  >
    {{ state.phase === 'error' ? 'Try again' : 'Install update' }}
  </button>

  <p
    v-if="state.phase === 'error' && state.error"
    class="update-check-modal-selfupdate-error"
    data-self-update-error
    role="alert"
  >
    {{ state.error }}
  </p>
</template>

<style scoped>
.update-check-modal-selfupdate-progress {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.update-check-modal-selfupdate-bar {
  display: block;
  width: 100%;
  height: 0.4rem;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  overflow: hidden;
}

.update-check-modal-selfupdate-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.25s ease;
}

.update-check-modal-selfupdate-fill.indeterminate {
  width: 40%;
  animation: update-check-modal-selfupdate-slide 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .update-check-modal-selfupdate-fill.indeterminate {
    animation: none;
    margin-left: 0;
    width: 100%;
  }
}

@keyframes update-check-modal-selfupdate-slide {
  0%   { margin-left: -40%; }
  100% { margin-left: 100%; }
}

.update-check-modal-selfupdate-label {
  font-size: var(--type-sm);
  letter-spacing: 0.06em;
  color: var(--text-dim);
}

.update-check-modal-selfupdate-error {
  margin: 0;
  font-size: var(--type-sm);
  color: var(--loss);
}
</style>
