<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import CoachReturnCard from '@/components/coach/inbox/CoachReturnCard.vue'
import { useCoachReturnDecisions } from '@/composables/coach/useCoachReturnDecisions'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useCoachReturnsStore } from '@/stores/coachReturns'

// The return of notes — the player decides on one coach's archive.
//
// Opens from the import that staged it, or from the Matches banner that
// keeps nagging while notes are undecided. Every verdict is held locally
// (useCoachReturnDecisions) and written in ONE partial PUT when the player
// finishes or puts it off, so flipping down a list of notes is not a
// request per click.
//
// Reads the store directly, like every other store-bound component; the
// staged sheet, the write, and the inbox refresh all live there.
const returns = useCoachReturnsStore()
const { returnSheet } = storeToRefs(returns)

const open = computed(() => returnSheet.value !== null)
const decisions = useCoachReturnDecisions(returnSheet)

const coachName = computed(() => returnSheet.value?.coach_name ?? 'your coach')
const summary = computed(() => returnSheet.value?.summary ?? '')
const notes = computed(() => returnSheet.value?.notes ?? [])
const mismatchedHandle = computed(() =>
  returnSheet.value?.player_mismatch ? returnSheet.value.player_handle : '')

// Set when the write came back an error. The verdicts are still in hand,
// so the honest move is to say so and let the player press Finish again —
// closing would throw away work the server never took.
const saveFailed = ref(false)

// One commit path behind both buttons: "Decide later" and "Finish" write
// the same partial map — they differ in what the player means by them, not
// in what is saved. An untouched sheet closes without a request.
//
// The store REJECTS on a failed write rather than swallowing it into the
// error banner, precisely so this caller can keep the dialog up.
async function commit() {
  const sheet = returnSheet.value
  if (sheet && decisions.dirty.value) {
    try {
      await returns.decide(sheet.id, decisions.body.value)
    } catch (_) {
      saveFailed.value = true
      return
    }
  }
  saveFailed.value = false
  returns.closeReturnSheet()
}

useModalFocusTrap(open, {
  containerSelector: '.coach-return-sheet',
  onClose: () => { void commit() },
})
</script>

<template>
  <div v-if="open" class="return-backdrop">
    <section
      class="paper coach-return-sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="`Notes from ${coachName}`"
    >
      <header class="return-head">
        <h2 class="return-title">
          Notes from {{ coachName }}
        </h2>
        <p v-if="summary" class="return-summary">
          {{ summary }}
        </p>
        <p v-if="mismatchedHandle" class="return-mismatch">
          This archive was written about {{ mismatchedHandle }}. Accept only what belongs here.
        </p>
        <p v-if="saveFailed" class="return-failed" role="alert">
          Your decisions could not be saved. Nothing was lost — they are still on this sheet.
          Try Finish again.
        </p>
      </header>

      <div class="return-bulk">
        <button type="button" class="paper-btn" @click="decisions.acceptAll()">
          Accept all
        </button>
        <button type="button" class="paper-btn" @click="decisions.skipAll()">
          Skip all
        </button>
      </div>

      <!-- Focusable because it scrolls: when every note is an orphan the
           cards carry no radios, and an unfocusable scroll container is
           unreachable by keyboard (axe scrollable-region-focusable). -->
      <div class="return-cards" tabindex="0" role="group" aria-label="Notes in this file">
        <CoachReturnCard
          v-for="note in notes"
          :key="note.note_id"
          :note="note"
          :verdict="decisions.verdictOf(note.note_id)"
          @decide="(d) => decisions.decide(note, d)"
        />
      </div>

      <footer class="return-foot">
        <button type="button" class="paper-btn" @click="commit">
          Decide later
        </button>
        <button type="button" class="paper-btn primary" @click="commit">
          Finish · save {{ decisions.acceptedCount.value }} accepted
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.return-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.2rem;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  backdrop-filter: blur(2px);
}

.coach-return-sheet {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  width: min(660px, 100%);
  max-height: min(86vh, 900px);
  padding: 1rem 1.1rem 1.1rem;
  overflow: hidden;
}

.return-head {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.return-title {
  margin: 0;
  font-family: var(--display);
  font-size: 1.9rem;
  letter-spacing: 0.02em;
  color: var(--ink);
}

.return-summary {
  margin: 0;
  font-size: var(--type-lg);
  line-height: 1.5;
  color: var(--ink-dim);
}

.return-mismatch,
.return-failed {
  margin: 0;
  font-size: var(--type-sm);
  line-height: 1.45;
  color: var(--paper-loss);
}

.return-failed { font-weight: 700; }

.return-bulk {
  display: flex;
  gap: 0.4rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--paper-rule);
}

.return-cards {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow-y: auto;
  padding-right: 0.2rem;
  scrollbar-width: thin;
}

.return-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--paper-rule);
}
</style>
