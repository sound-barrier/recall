<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useCoachReturnsStore } from '@/stores/coachReturns'
import { pluralize } from '@/match/reviews/reviews-helpers'

// "3 notes from Ordo waiting · Read the notes" — the nag that sits above the
// dossier until every returned note is decided.
//
// The count is the SERVER's derived pending tally, not local state, so it
// survives a reload and a "Decide later" exactly as it should: closing the
// sheet with notes still undecided leaves the banner up.
const returns = useCoachReturnsStore()
const { inbox } = storeToRefs(returns)

const pending = computed(() => returns.pendingNoteCount)
// One coach is named; two or more are counted — the tally is the SUM over
// every sheet, and putting one name on all of it would credit that coach
// with notes another wrote.
const from = computed(() => {
  const coaches = returns.pendingCoachCount
  return coaches > 1 ? `${coaches} coaches` : returns.firstPendingCoach
})
const line = computed(() =>
  `${pluralize(pending.value, 'note')} from ${from.value} waiting`)

// The sheet the Read-the-notes button opens: the first one still holding an
// undecided note — the same one the copy names.
const firstPendingId = computed(() => inbox.value.find((sheet) => sheet.pending > 0)?.id ?? null)

function review() {
  const id = firstPendingId.value
  if (id !== null) void returns.openReturnSheet(id)
}
</script>

<template>
  <div
    v-if="pending > 0 && firstPendingId !== null"
    class="coach-inbox"
    role="status"
    aria-label="Coaching inbox"
  >
    <span class="eyebrow accent coach-inbox-eyebrow">Coaching</span>
    <span class="coach-inbox-line">{{ line }}</span>
    <button type="button" class="btn ghost coach-inbox-review" @click="review">
      Read the notes
    </button>
  </div>
</template>

<style scoped>
.coach-inbox {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.7rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
}

.coach-inbox-eyebrow { flex: none; }

.coach-inbox-line {
  flex: 1 1 auto;
  font-size: var(--type-lg);
  color: var(--text);
}

.coach-inbox-review { flex: none; }
</style>
