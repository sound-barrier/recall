<script setup lang="ts">
import type { ExclusionReason } from '@/api-client'

// Why this match should not count. Independent toggles rather than a
// radiogroup, matching the disruption chooser beside it: clicking the
// active reason clears it, which is the only "unset" a user ever wants
// and saves them hunting for a separate control.
//
// A match carries at most one reason — these are alternatives, not a set —
// so picking a second replaces the first.
const props = defineProps<{
  current: ExclusionReason
  writesLocked: boolean
  lockReason: string
}>()

const emit = defineEmits<{
  'set-exclusion': [ExclusionReason]
}>()

// `mark` is spelled per reason rather than composed — "as a MMR adjustment"
// is what composition produces, and a screen reader reads the article out
// loud. It stays the SAME in both states: `aria-pressed` is what carries
// on/off, and a name that changed with state would announce the chip as a
// different control each time it was pressed.
const REASONS: {
  reason: Exclude<ExclusionReason, ''>
  label: string
  mark: string
  hint: string
}[] = [
  {
    reason: 'placement', label: 'Placement',
    mark: 'Mark this match as a placement',
    hint: 'a placement or calibration game',
  },
  {
    reason: 'mmr_adjustment', label: 'MMR adjustment',
    mark: 'Mark this match as an MMR adjustment',
    hint: 'a rank correction the system applied',
  },
  {
    reason: 'outage', label: 'Outage',
    mark: 'Mark this match as an outage',
    hint: 'lost to your connection, not the other team',
  },
]

function isOn(reason: ExclusionReason): boolean {
  return props.current === reason
}

// Clicking the live reason clears it; clicking another replaces it.
function toggle(reason: Exclude<ExclusionReason, ''>) {
  emit('set-exclusion', isOn(reason) ? '' : reason)
}
</script>

<template>
  <div class="dis-chooser" role="group" aria-label="Why this match should not count">
    <span class="eyebrow dis-chooser-label" aria-hidden="true">Doesn't count</span>
    <button
      v-for="r in REASONS"
      :key="r.reason"
      type="button"
      class="dis-chip"
      :class="{ active: isOn(r.reason) }"
      :aria-pressed="isOn(r.reason)"
      :aria-label="r.mark"
      :data-exclusion="r.reason"
      :disabled="writesLocked"
      :title="lockReason || `${r.hint} — it stays on the list, out of your win rate.`"
      @click="toggle(r.reason)"
    >
      {{ r.label }}
    </button>
  </div>
</template>

<style src="./match-choosers.css"></style>
