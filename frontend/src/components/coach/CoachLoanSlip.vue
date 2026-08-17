<script setup lang="ts">
import { computed, ref } from 'vue'

import { formatLocalFromUTC } from '@/match/match-time-helpers'
import { noteMark } from '@/match/coach/coach-notes'
import { useCoachStore } from '@/stores/coach'

// The loan slip — the masthead while a coaching session is open.
//
// It takes the profile chip's place because it answers the same question:
// whose data is on screen. Everything else on it is the loan's terms — how
// much was lent, when it was exported, that none of it is being kept, and
// the two ways the session can end (with the notes, or without them).

const coach = useCoachStore()

// A plain export names nobody, so the slip has a blank where the handle
// goes until the room's "Who is this?" prompt is answered. Saying so is
// better than a masthead that reads "reviewing" and then stops.
const UNNAMED_PLAYER = 'a player not yet named'
const handle = computed(() =>
  (coach.needsPlayerHandle ? UNNAMED_PLAYER : coach.player?.handle ?? ''))
const label = computed(() => `Coaching session: reviewing ${handle.value}`)

const loanLine = computed(() => {
  const count = coach.session?.match_count ?? 0
  const exported = formatLocalFromUTC(coach.session?.exported_at)
  const matches = `${count} match${count === 1 ? '' : 'es'}`
  return exported ? `${matches} · exported ${exported}` : matches
})

// Marks, not drafts: a half-typed note that says nothing yet isn't a note.
const noteCount = computed(() =>
  Object.values(coach.notes).filter(draft => noteMark(draft) !== null).length)
const notesLine = computed(() => `Notes · ${noteCount.value}`)

// The store owns both refusals — an unsigned archive and one that would be
// missing a note whose save never landed.
const canExport = computed(() => coach.canExportNotes)
const exportTitle = computed(() =>
  canExport.value ? 'Save the notes archive for the player' : coach.exportBlockedReason)

// Ending discards the loan. The notes themselves are saved server-side, but
// the ARCHIVE the player receives only exists once it has been exported —
// so unexported work earns a second question rather than a silent goodbye.
const endArmed = ref(false)
function requestEnd() {
  if (coach.dirtySinceExport && !endArmed.value) {
    endArmed.value = true
    return
  }
  endArmed.value = false
  void coach.endSession()
}
</script>

<template>
  <section class="paper coach-slip" :aria-label="label">
    <p class="eyebrow ink coach-slip-eyebrow">
      Coaching session
    </p>
    <p class="coach-slip-handle">
      {{ handle }}
    </p>
    <p class="coach-slip-line">
      {{ loanLine }}
    </p>
    <p class="coach-slip-promise">
      Nothing here is saved to your profile.
    </p>
    <p class="coach-slip-line">
      {{ notesLine }}
    </p>
    <div class="coach-slip-actions">
      <button
        type="button"
        class="paper-btn coach-slip-btn"
        :disabled="!canExport"
        :title="exportTitle"
        @click="coach.exportNotes()"
      >
        Export notes
      </button>
      <button
        v-if="!endArmed"
        type="button"
        class="paper-btn coach-slip-btn"
        title="Discard the loaned records and go back to your own history"
        @click="requestEnd"
      >
        End session
      </button>
      <button
        v-else
        type="button"
        class="paper-btn primary coach-slip-btn"
        title="These notes have not been exported yet"
        @click="requestEnd"
      >
        End anyway — notes not exported
      </button>
    </div>
  </section>
</template>

<style scoped>
.coach-slip {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0.75rem;
  min-width: 15rem;
  text-align: left;
}

.coach-slip-eyebrow {
  margin: 0 0 0.1rem;
}

.coach-slip-handle {
  margin: 0;
  font-family: var(--display);
  font-size: var(--type-5xl);
  line-height: 1.1;
  color: var(--ink);
}

.coach-slip-line {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.06em;
  color: var(--ink-dim);
}

.coach-slip-promise {
  margin: 0.15rem 0;
  font-family: var(--body);
  font-size: var(--type-2xs);
  font-style: italic;
  color: var(--ink-faint);
}

.coach-slip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}

.coach-slip-btn {
  padding: 0.3rem 0.55rem;
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
}
</style>
