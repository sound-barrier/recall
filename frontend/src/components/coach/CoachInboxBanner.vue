<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useCoachStore } from '@/stores/coach'

// "3 notes from Ordo waiting · Review" — the nag that sits above the
// dossier until every returned note is decided.
//
// The count is the SERVER's derived pending tally, not local state, so it
// survives a reload and a "Decide later" exactly as it should: closing the
// sheet with notes still undecided leaves the banner up.
const coach = useCoachStore()
const { inbox } = storeToRefs(coach)

const pending = computed(() => coach.pendingNoteCount)
const coachName = computed(() => coach.firstPendingCoach)
const line = computed(() =>
  `${pending.value} note${pending.value === 1 ? '' : 's'} from ${coachName.value} waiting`)

// The sheet the Review button opens: the first one still holding an
// undecided note — the same one the copy names.
const firstPendingId = computed(() => inbox.value.find((sheet) => sheet.pending > 0)?.id ?? null)

function review() {
  const id = firstPendingId.value
  if (id !== null) void coach.openReturnSheet(id)
}
</script>

<template>
  <div v-if="pending > 0 && firstPendingId !== null" class="coach-inbox" role="status">
    <span class="eyebrow accent coach-inbox-eyebrow">Coaching</span>
    <span class="coach-inbox-line">{{ line }}</span>
    <button type="button" class="btn ghost coach-inbox-review" @click="review">
      Review
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
