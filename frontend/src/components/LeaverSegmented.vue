<script setup lang="ts">
// Three-state segmented control for leaver-match handling. Only
// renders when at least one match carries a user-set leaver
// annotation (otherwise the control is noise).
//
// Extracted from FilterRail so the radio-pattern wiring stays
// self-contained.

type LeaverHandling = 'include' | 'exclude-tally' | 'hide'

defineProps<{
  leaverHandling: LeaverHandling
  annotatedMatchCount: number
}>()

const emit = defineEmits<{
  'set-leaver-handling': [next: LeaverHandling]
}>()
</script>

<template>
  <div
    v-if="annotatedMatchCount > 0"
    class="leaver-segmented"
    role="radiogroup"
    aria-label="Leaver-match handling"
    :title="`${annotatedMatchCount} match${annotatedMatchCount === 1 ? '' : 'es'} tagged as a leaver scenario.`"
  >
    <span class="leaver-label" aria-hidden="true">⚑ leaver · {{ annotatedMatchCount }}</span>
    <button
      type="button"
      class="leaver-seg"
      :class="{ active: leaverHandling === 'include' }"
      :aria-checked="leaverHandling === 'include'"
      role="radio"
      title="Show leaver matches and count them in the W/L/D tally (default)."
      @click="emit('set-leaver-handling', 'include')"
    >
      Show
    </button>
    <button
      type="button"
      class="leaver-seg"
      :class="{ active: leaverHandling === 'exclude-tally' }"
      :aria-checked="leaverHandling === 'exclude-tally'"
      role="radio"
      title="Show leaver matches in the list, but skip them in the W/L/D tally."
      @click="emit('set-leaver-handling', 'exclude-tally')"
    >
      Skip tally
    </button>
    <button
      type="button"
      class="leaver-seg"
      :class="{ active: leaverHandling === 'hide' }"
      :aria-checked="leaverHandling === 'hide'"
      role="radio"
      title="Hide leaver matches from the list entirely."
      @click="emit('set-leaver-handling', 'hide')"
    >
      Hide
    </button>
  </div>
</template>

<style scoped>
/* A small inline radiogroup with a leading label + count chip.
   Shares the visual footprint of `.undated-toggle` so the filter
   tools row stays rhythmic, but renders three click targets so the
   user can pick include / exclude-tally / hide in one place. Only
   surfaces when at least one annotated match exists. */

.leaver-segmented {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  padding: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
}

.leaver-label {
  display: inline-flex;
  align-items: center;
  padding: 0 0.5rem 0 0.4rem;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.leaver-seg {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0.28rem 0.55rem;
  border-radius: 1px;
  color: var(--text-faint);
  font: inherit;
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}

.leaver-seg:hover {
  color: var(--text);
}

.leaver-seg.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.leaver-seg:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft), inset 0 0 0 1px var(--accent);
}
</style>
