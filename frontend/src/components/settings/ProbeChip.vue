<script setup lang="ts">
import { computed, watch } from 'vue'

// The detect-result chip, shared by the three Settings surfaces that run a
// probe: first-run setup, the screenshots-folder section, and the Tesseract
// engine section. Each carried its own copy of the same three-line state
// machine and ~22 lines of identical markup, and their dismiss labels had
// already drifted apart. The label is a REQUIRED prop rather than a default
// so the next surface has to decide what its chip is about instead of
// inheriting whatever the copy it was pasted from happened to say.
const props = defineProps<{
  message?: string
  status?: '' | 'success' | 'blocked'
  dismissLabel: string
}>()

// Dismissal belongs to the parent: on the first-run surface the "Looked in"
// disclosure hides along with the chip, so it has to read the same flag.
const dismissed = defineModel<boolean>('dismissed', { required: true })

// A fresh probe message re-opens the chip, so a second Detect click shows its
// result instead of landing silently behind an earlier dismissal.
watch(() => props.message, (next) => {
  if (next) dismissed.value = false
})

const show = computed(() => !!props.message && !dismissed.value)
</script>

<template>
  <div v-if="show" class="probe-chip" :class="status" role="status">
    <span class="probe-chip-bar" aria-hidden="true" />
    <span class="probe-chip-mark" aria-hidden="true">
      {{ status === 'success' ? '✓' : '⚠' }}
    </span>
    <span class="probe-chip-text">{{ message }}</span>
    <button
      type="button"
      class="probe-chip-close"
      :aria-label="dismissLabel"
      @click="dismissed = true"
    >
      ×
    </button>
  </div>
</template>
