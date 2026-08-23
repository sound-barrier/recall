<script setup lang="ts">
import { focusTagLabel, type FocusCount } from '@/match/coach/coach-notes'

// "Focus so far": the tally of focus tags across the sitting's notes, and the
// one-line count under it ("7 notes · 19 moments · 1 reviewed only").
//
// The TALLY half is a coach's readout: focus tags are filed by a coach
// writing about someone else's matches. A player's own sitting has no tag
// chips on its notes, so the tally there would be permanently empty — it
// turns off, and the count line (which is true either way) stays.
withDefaults(defineProps<{
  focusTally: FocusCount[]
  notesLine: string
  showTally?: boolean
}>(), { showTally: true })
</script>

<template>
  <div class="sheet-block">
    <span v-if="showTally" class="eyebrow ink">Focus so far</span>
    <ul v-if="showTally && focusTally.length" class="sheet-tally" aria-label="Focus tally">
      <li v-for="row in focusTally" :key="row.tag" class="tally-row">
        <span class="tally-tag">{{ focusTagLabel(row.tag) }}</span>
        <span class="tally-count">{{ row.count }}</span>
      </li>
    </ul>
    <p v-else-if="showTally" class="sheet-quiet">
      No focus tags yet.
    </p>
    <p class="sheet-notes-line">
      {{ notesLine }}
    </p>
  </div>
</template>

<style scoped>
.sheet-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.sheet-tally {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tally-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.12rem 0;
  border-bottom: 1px dotted var(--paper-rule);
}

.tally-tag {
  font-size: var(--type-lg);
  color: var(--ink-dim);
}

.tally-count {
  font-family: var(--mono);
  font-size: var(--type-md);
  color: var(--ink);
  font-feature-settings: "tnum";
}

.sheet-quiet, .sheet-notes-line {
  margin: 0;
  font-size: var(--type-md);
  color: var(--ink-faint);
}

.sheet-notes-line { margin-top: 0.3rem; }
</style>
