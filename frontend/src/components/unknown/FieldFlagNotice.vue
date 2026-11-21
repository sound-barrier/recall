<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useMatchesStore } from '@/stores/matches'

// "3 fields left out of your stats pending review" — above the dossier,
// because the numbers right below it are the ones those readings would have
// changed. The review itself is the Unknown tab's: readings whose sources
// disagree are triage work, like a screenshot that matched nothing.
//
// A status region: the count changes under the player's eyes as a watcher
// parse lands or a review elsewhere settles a flag.
//
// In a coaching session the dossier is the player's loaned corpus: the
// readings are still left out, but they are not the coach's, and settling
// one is the player's write. So the notice says whose stats these are and
// offers no review.
const { leftOutFieldCount } = storeToRefs(useMatchesStore())
const { goToView } = useAppStore()
const coach = useCoachStore()
const loaned = computed(() => coach.sessionActive)

const label = computed(() => (loaned.value ? "Readings left out of the player's stats" : 'Readings left out of your stats'))
const line = computed(() => {
  const n = leftOutFieldCount.value
  const fields = `${n} ${n === 1 ? 'field' : 'fields'} left out of`
  if (!loaned.value) return `${fields} your stats pending review`
  return `${fields} these stats until the player reviews ${n === 1 ? 'it' : 'them'}`
})
</script>

<template>
  <div
    v-if="leftOutFieldCount > 0"
    class="field-flag-notice"
    role="status"
    :aria-label="label"
  >
    <span class="eyebrow accent field-flag-notice-eyebrow">Needs a look</span>
    <span class="field-flag-notice-line">{{ line }}</span>
    <button
      v-if="!loaned"
      type="button"
      class="btn ghost field-flag-notice-cta"
      @click="goToView('unknown')"
    >
      Review flagged readings
    </button>
  </div>
</template>

<style scoped>
/* Layout only, matching the parser-staleness notice it stacks under — the
   type comes from .eyebrow.accent and .btn.ghost. */
.field-flag-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
}

.field-flag-notice-eyebrow,
.field-flag-notice-cta { flex: none; }

.field-flag-notice-line {
  flex: 1 1 auto;
  font-size: var(--type-lg);
  color: var(--text);
}
</style>
