<script setup lang="ts">
// In-app self-update CTA — progress bar / Install / Restart / error / refusal.
// A private partial of AboutModal's "Recall app" section (parallel to
// UpdateDiffManifest): the parent gates rendering on
// `info.available && canSelfUpdate` and supplies the shared
// `update-check-modal-btn*` chrome via `:deep()`. The self-update state machine
// lives in the app store — this component only renders the `SelfUpdateState`
// bundle and re-emits install / restart.

import { computed } from 'vue'
import type { SelfUpdateState } from '@/self-update-events'

const props = defineProps<{ state: SelfUpdateState }>()

const emit = defineEmits<{
  install: []
  restart: []
}>()

// After a refusal the control still runs the whole pass, and it downloads and
// installs a release that now verifies, so the label names both steps rather
// than promising a check alone.
const RETRY_LABEL: Partial<Record<SelfUpdateState['phase'], string>> = {
  error:   'Try again',
  refused: 'Check and install again',
}
const installLabel = computed(() => RETRY_LABEL[props.state.phase] ?? 'Install update')

// Phase groupings for the CTA template.
const busy = computed(() =>
  ['starting', 'downloading', 'verifying', 'installing', 'restarting'].includes(props.state.phase))
// Every phase is a key, so a NEW phase has to be placed on purpose. The
// progress bar only renders while `busy`, so the idle, ready, error and
// refused entries never reach the screen.
const PROGRESS_LABEL: Record<SelfUpdateState['phase'], string> = {
  starting:    'Starting…',
  downloading: 'Downloading…',
  verifying:   'Verifying…',
  installing:  'Installing…',
  restarting:  'Restarting…',
  idle:        'Starting…',
  ready:       'Starting…',
  error:       'Starting…',
  refused:     'Starting…',
}
const progressLabel = computed(() => {
  const { phase, pct } = props.state
  if (phase === 'downloading' && pct != null) return `Downloading… ${pct}%`
  return PROGRESS_LABEL[phase]
})
</script>

<template>
  <div
    v-if="state.phase === 'refused'"
    class="update-check-modal-selfupdate-refused"
    role="alert"
  >
    <strong>Update not installed</strong>
    <p class="update-check-modal-selfupdate-refused-line">
      Recall couldn't verify this update as an official Recall release, so it
      didn't install it. Nothing on your computer was changed.
    </p>
    <!-- In the attack case the refused release is the payload, so this line
         must never send anyone to fetch it by hand. -->
    <p class="update-check-modal-selfupdate-refused-line">
      Don't install this release by hand. Wait for the next release, or check
      Recall's Security advisories page on GitHub.
    </p>
  </div>

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
    {{ installLabel }}
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
  transition: width var(--duration-relaxed) ease;
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

.update-check-modal-selfupdate-refused {
  margin-bottom: var(--space-3);
  padding-left: var(--space-3);
  border-left: 3px solid var(--loss);
  font-size: var(--type-sm);
  line-height: 1.5;
  color: var(--text);
}

.update-check-modal-selfupdate-refused-line {
  margin: var(--space-2) 0 0;
  color: var(--text-dim);
}
</style>
